/**
 * Follows a child session's stream so a delegated turn stops looking dead.
 *
 * A declared subagent runs in its own session. The parent's stream carries only
 * `subagent.called` and `subagent.completed`, and the parent is suspended for
 * everything between — so from out here a `code_task` is a turn that says
 * nothing for as long as the work takes. Two things went wrong because of that:
 * nobody could see what it was doing, and nothing refreshed the lease, so the
 * sweep reclaimed a turn that was working perfectly well.
 *
 * The bot is the only place this can live. It holds sockets; the agent cannot.
 *
 * What the follower writes is bot-owned on purpose. The intent stays the
 * agent's alone — the child's progress lands in the projection and the renderer
 * merges it, so nothing here invents content the agent is supposed to author.
 */

import type { Delegation } from "@repo/shared/conversations";
import { jsonText } from "@repo/shared/json";
import { z } from "zod";

import type { ConversationFlowDeps } from "./types.ts";

/** Child events worth showing. Anything else is noise at this distance. */
const SHOWN = new Set(["action.started", "message.completed", "step.started"]);

const MAX_LINE = 200;

interface Follower {
  readonly stop: () => void;
}

const running = new Map<string, Follower>();

/**
 * A child agent's event, parsed at the boundary rather than inspected.
 *
 * Loose on purpose: this is another agent's payload and not our wire contract,
 * so an unrecognised shape must render nothing rather than throw. Only the two
 * fields worth showing are named.
 */
const childEventSchema = z.looseObject({
  type: z.string(),
  data: z
    .looseObject({
      actions: z.array(z.looseObject({ toolName: z.string() })).optional(),
      message: z.string().optional(),
    })
    .optional(),
});

type ChildEvent = z.output<typeof childEventSchema>;

function summarize(subagent: string, event: ChildEvent): string | undefined {
  if (!SHOWN.has(event.type)) return undefined;
  const tools = event.data?.actions?.map((action) => action.toolName) ?? [];
  if (tools.length > 0) return `${subagent}: ${tools.join(", ")}`;
  const said = event.data?.message?.trim();
  return said === undefined || said === ""
    ? undefined
    : `${subagent}: ${said.replaceAll(/\s+/gu, " ")}`;
}

/**
 * Read the child's stream until it ends or the delegation is withdrawn.
 *
 * Every line seen is also proof the turn is alive, so the lease is pushed out on
 * the same event that updates the text. A refresh that reports `false` means
 * this delivery no longer owns the turn, and the follower stops rather than
 * narrating over whatever replaced it.
 */
interface FollowInput {
  readonly deps: ConversationFlowDeps;
  readonly dispatchId: string;
  readonly continuationKey: string;
  readonly delegation: Delegation;
  readonly signal: AbortSignal;
  readonly onLine: (line: string) => Promise<void>;
}

async function follow({
  deps,
  dispatchId,
  continuationKey,
  delegation,
  signal,
  onLine,
}: FollowInput): Promise<void> {
  const url = new URL(`/eve/v1/session/${delegation.childSessionId}/stream`, deps.eve.baseUrl);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${delegation.streamToken}` },
    signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error(`child stream returned ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const complete = buffered.split("\n");
      buffered = complete.pop() ?? "";
      for (const line of complete) {
        if (!line.startsWith("data:")) continue;
        const parsed = childEventSchema.safeParse(jsonText.safeParse(line.slice(5)).data);
        if (!parsed.success) continue;
        const summary = summarize(delegation.name, parsed.data);
        if (summary === undefined) continue;

        const held = await deps.store.queue.refreshLease(continuationKey, dispatchId);
        if (!held) return;
        await onLine(summary.slice(0, MAX_LINE));
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Start following, unless this delivery is already being followed.
 *
 * Idempotent because the render sweep revisits a dispatch on every pass, and a
 * second stream would double every line and double every lease refresh.
 */
export function followSubagent(
  deps: ConversationFlowDeps,
  dispatchId: string,
  continuationKey: string,
  delegation: Delegation,
  onLine: (line: string) => Promise<void>,
): void {
  if (running.has(dispatchId)) return;
  const controller = new AbortController();
  running.set(dispatchId, { stop: () => controller.abort() });

  void follow({ deps, dispatchId, continuationKey, delegation, signal: controller.signal, onLine })
    .catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      deps.reporter.emit({
        op: "agent.render.follow-subagent",
        status: "error",
        errorTag: "FollowFailed",
        errorMessage: cause instanceof Error ? cause.message : String(cause),
        attributes: { dispatchId, childSessionId: delegation.childSessionId },
      });
    })
    .finally(() => {
      running.delete(dispatchId);
    });
}

/** Called when the turn ends, so a finished delivery leaves nothing streaming. */
export function stopFollowing(dispatchId: string): void {
  running.get(dispatchId)?.stop();
  running.delete(dispatchId);
}

/** Shutdown: every open child stream is dropped before the process goes. */
export function stopAllFollowers(): void {
  for (const follower of running.values()) follower.stop();
  running.clear();
}
