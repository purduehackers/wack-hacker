/** A Discord presentation of the existing render state, not another task lifecycle. */

import type { TaskControl } from "@repo/shared/conversations";
import { stored } from "@repo/shared/json";
import { sliceText } from "@repo/shared/text";
import type { RenderIntent, RenderTarget } from "@repo/shared/wire";
import { ButtonStyle, ComponentType, escapeMarkdown } from "discord.js";
import type { APIActionRowComponent, APIButtonComponentWithCustomId } from "discord.js";
import { z } from "zod";

const CARD_LIMIT = 1_900;
const LONG_ANSWER = 1_500;
const FULL_RESULT_NOTE = "-# Open Full result to read the complete response.";
const requestContent = stored(z.looseObject({ content: z.string() }));

export type WorkCardState =
  | "working"
  | "input"
  | "approval"
  | "connection"
  | "failed"
  | "ready"
  | "stop-requested"
  | "stopping"
  | "cancelled";

export function workCardState(intent: RenderIntent, control?: TaskControl): WorkCardState {
  const matching =
    control?.sessionId === intent.sessionId && control.eveTurnId === intent.eveTurnId;
  if (matching && control.outcome === "cancelled") return "cancelled";
  if (intent.phase === "failed") return "failed";
  if (intent.phase === "completed") return "ready";
  if (matching && control.request?.status === "accepted") return "stopping";
  if (matching && control.request?.status === "pending") return "stop-requested";
  const request = intent.inputRequests?.[0];
  if (request !== undefined) return request.kind === "tool-approval" ? "approval" : "input";
  if ((intent.authorizations?.length ?? 0) > 0) return "connection";
  return "working";
}

const STATUS: Readonly<Record<WorkCardState, string>> = {
  working: "Working",
  input: "Your input is needed",
  approval: "Approval is needed",
  connection: "Connection is needed",
  failed: "Stopped — needs attention",
  // Completed is a transport boundary, including steering cancellation. It is
  // not proof that every requested effect succeeded.
  ready: "Response ready",
  "stop-requested": "Stop requested",
  stopping: "Stopping",
  cancelled: "Cancelled",
};

export function workCardStatus(intent: RenderIntent, control?: TaskControl): string {
  return STATUS[workCardState(intent, control)];
}

export function cancellationNote(intent: RenderIntent, control?: TaskControl): string | undefined {
  return workCardState(intent, control) === "cancelled"
    ? "This task was stopped. Actions already completed remain completed."
    : undefined;
}

export function needsWorkCard(intent: RenderIntent, progress?: string): boolean {
  return (
    workCardState(intent) !== (intent.phase === "completed" ? "ready" : "working") ||
    intent.text.length > LONG_ANSWER ||
    (intent.activity !== "" && !/^(?:thinking|working|typing)[.\s…]*$/iu.test(intent.activity)) ||
    (progress !== undefined && progress !== "")
  );
}

/** Store the escaped title once so later answers cannot change the task's identity. */
export function workCardTitle(deliveryRaw?: string): string {
  const content = requestContent.safeParse(deliveryRaw).data?.content ?? "";
  const title = escapeMarkdown(content.replace(/\s+/gu, " ").trim());
  return sliceText(title === "" ? "Your request" : title, 120);
}

/** Keep recovery instructions; only the known machine-generated usage footer is hidden. */
export function publicFooter(footer?: string): string | undefined {
  if (footer === undefined || footer === "") return undefined;
  if (/^`[^`]+`(?: · (?:[\d,.]+s|[\d,]+ tokens|[\d,]+ tool calls?))*$/u.test(footer)) {
    return undefined;
  }
  return footer.replace(/ — reference [\da-z]+$/iu, "");
}

function progressText(progress?: string): string | undefined {
  if (progress === undefined) return undefined;
  const narration = progress.replace(/^[\w-]+:\s*/u, "").trim();
  if (narration === "" || /^(?:calling|delegating to|asking|loading)\b/iu.test(narration)) {
    return undefined;
  }
  return sliceText(narration, 200);
}

function idleText(state: WorkCardState): string {
  switch (state) {
    case "input":
    case "approval":
    case "connection":
      return "Use the request below to continue.";
    case "failed":
      return "I couldn't finish this turn. Open Details for context before retrying.";
    case "ready":
      return "This turn has ended.";
    case "working":
      return "I'll keep the useful progress and result here.";
    case "stop-requested":
      return "Your stop request is saved. Waiting for the agent to acknowledge it.";
    case "stopping":
      return "The agent accepted the stop request. Waiting for the task to end.";
    case "cancelled":
      return "This task was stopped. Actions already completed remain completed.";
  }
}

export function workCardCustomId(
  dispatchId: string,
  revision: number,
  action: "details" | "result" | "stop",
): string {
  return `wack-work:${dispatchId}:${revision}:${action}`;
}

/** Keep a clipped fenced example from swallowing the full-result hint. */
function clippedPreview(content: string): string {
  const prefix = sliceText(content, CARD_LIMIT - FULL_RESULT_NOTE.length - 6);
  const open = (prefix.match(/^```/gmu)?.length ?? 0) % 2 === 1;
  return `${prefix}${open ? "\n```" : ""}\n\n${FULL_RESULT_NOTE}`;
}

const locatorSchema = z.strictObject({
  dispatchId: z.uuid(),
  revision: z.coerce.number().pipe(z.int().positive()),
  action: z.enum(["details", "result", "stop"]),
});

export function parseWorkCardCustomId(customId: string) {
  const [prefix, dispatchId, revision, action, extra] = customId.split(":");
  if (prefix !== "wack-work" || extra !== undefined || !/^\d+$/u.test(revision ?? "")) {
    return undefined;
  }
  return locatorSchema.safeParse({ dispatchId, revision, action }).data;
}

export function renderWorkCard(input: {
  readonly intent: RenderIntent;
  readonly target: RenderTarget;
  readonly title: string;
  readonly progress?: string;
  readonly control?: TaskControl;
  readonly canCancel?: boolean;
}) {
  const { intent, target, title } = input;
  const state = workCardState(intent, input.control);
  const header = `### ${title}\n-# ${STATUS[state]} · Requested by <@${target.requesterUserId}>`;
  const footer = publicFooter(intent.footer);
  const progress = intent.phase === "streaming" ? progressText(input.progress) : undefined;
  const stoppedNote = cancellationNote(intent, input.control);
  const body = [
    progress,
    intent.text || idleText(state),
    intent.text === "" ? undefined : stoppedNote,
    footer,
  ]
    .filter((section) => section !== undefined && section !== "")
    .join("\n\n");
  const full = `${header}\n\n${body}`;
  const clipped = full.length > CARD_LIMIT;
  const text = clipped ? clippedPreview(full) : full;
  const buttons: APIButtonComponentWithCustomId[] = [];
  if (clipped) {
    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      custom_id: workCardCustomId(intent.dispatchId, intent.revision, "result"),
      label: "Full result",
    });
  }
  buttons.push({
    type: ComponentType.Button,
    style: ButtonStyle.Secondary,
    custom_id: workCardCustomId(intent.dispatchId, intent.revision, "details"),
    label: "Details",
  });
  if (
    input.canCancel &&
    intent.phase === "streaming" &&
    input.control?.sessionId === intent.sessionId &&
    input.control.eveTurnId === intent.eveTurnId &&
    input.control.outcome === undefined &&
    input.control.request === undefined
  ) {
    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Danger,
      custom_id: workCardCustomId(intent.dispatchId, intent.revision, "stop"),
      label: "Stop",
    });
  }
  const components: APIActionRowComponent<APIButtonComponentWithCustomId>[] = [
    { type: ComponentType.ActionRow, components: buttons },
  ];
  return {
    text,
    components,
    fullText: full,
    fullResult: clipped
      ? [intent.text, stoppedNote, footer]
          .filter((section) => section !== undefined && section !== "")
          .join("\n\n")
      : undefined,
  };
}
