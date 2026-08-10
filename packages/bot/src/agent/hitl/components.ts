import { sliceText } from "@repo/shared/text";
import type {
  RenderAuthorization,
  RenderInputOption,
  RenderInputRequest,
  RenderIntent,
} from "@repo/shared/wire";
import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIButtonComponentWithCustomId,
  APIComponentInMessageActionRow,
} from "discord.js";
import { ButtonStyle, ComponentType } from "discord.js";
import { z } from "zod";

const MAX_ROWS = 5;

export type HitlLocator =
  | {
      readonly kind: "input";
      readonly dispatchId: string;
      readonly revision: number;
      readonly requestIndex: number;
      readonly action: "freeform" | "modal" | "option" | "select";
      readonly index?: number;
    }
  | {
      readonly kind: "authorization";
      readonly dispatchId: string;
      readonly revision: number;
      readonly authorizationIndex: number;
    };

interface HitlView {
  readonly notice?: string;
  readonly components: APIActionRowComponent<APIComponentInMessageActionRow>[];
}

function inputCustomId(
  dispatchId: string,
  revision: number,
  requestIndex: number,
  action: string,
): string {
  return `eve-hitl:i:${dispatchId}:${revision}:${requestIndex}:${action}`;
}

function authCustomId(dispatchId: string, revision: number, index: number): string {
  return `eve-hitl:a:${dispatchId}:${revision}:${index}`;
}

function optionButtonStyle(option: RenderInputOption): APIButtonComponentWithCustomId["style"] {
  if (option.id === "approve") return ButtonStyle.Success;
  if (option.id === "deny" || option.style === "danger") return ButtonStyle.Danger;
  return option.style === "primary" ? ButtonStyle.Primary : ButtonStyle.Secondary;
}

function inputRows(
  intent: RenderIntent,
  request: RenderInputRequest,
  requestIndex: number,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const rows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];
  const entries = request.options ?? [];
  const freeform = request.kind === "question" && (request.allowFreeform || entries.length === 0);
  const useButtons = request.display !== "select" && entries.length > 0 && entries.length <= 5;

  if (useButtons) {
    rows.push({
      type: ComponentType.ActionRow,
      components: entries.map((choice, optionIndex) => ({
        type: ComponentType.Button,
        custom_id: inputCustomId(
          intent.dispatchId,
          intent.revision,
          requestIndex,
          `o${optionIndex}`,
        ),
        label: sliceText(choice.label, 80),
        style: optionButtonStyle(choice),
      })),
    });
  } else {
    const maxOptionRows = freeform ? MAX_ROWS - 1 : MAX_ROWS;
    for (let offset = 0; offset < entries.length && rows.length < maxOptionRows; offset += 25) {
      const chunk = entries.slice(offset, offset + 25);
      rows.push({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: inputCustomId(
              intent.dispatchId,
              intent.revision,
              requestIndex,
              `s${offset}`,
            ),
            placeholder: sliceText(request.prompt.replace(/\s+/gu, " "), 150),
            min_values: 1,
            max_values: 1,
            options: chunk.map((choice, chunkIndex) => ({
              label: sliceText(choice.label, 100),
              value: `o${offset + chunkIndex}`,
              ...(choice.description === undefined || choice.description === ""
                ? {}
                : { description: sliceText(choice.description, 100) }),
            })),
          },
        ],
      });
    }
  }

  if (freeform && rows.length < MAX_ROWS) {
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          custom_id: inputCustomId(intent.dispatchId, intent.revision, requestIndex, "f"),
          label: entries.length === 0 ? "Answer" : "Type another answer",
          style: ButtonStyle.Primary,
        },
      ],
    });
  }
  return rows;
}

function publicInputNotice(request: RenderInputRequest): string {
  const heading = request.kind === "tool-approval" ? "Approval required" : "Input required";
  const promptLength = request.kind === "tool-approval" ? 300 : 800;
  const audience =
    request.approvalMode === "second-party"
      ? ` from a different ${request.approverMinRole ?? "organizer"}`
      : ` for <@${request.recipientUserId}>`;
  const sections = [`**${heading}${audience}**`, sliceText(request.prompt, promptLength)];
  if (request.toolName !== undefined) {
    sections.push(`Tool: \`${sliceText(request.toolName.replaceAll("`", ""), 100)}\``);
  }
  if (request.inputPreview !== undefined) {
    sections.push(`\`\`\`json\n${sliceText(request.inputPreview, 350)}\n\`\`\``);
  }
  return sections.join("\n\n");
}

function authorizationName(authorization: RenderAuthorization): string {
  return authorization.displayName ?? authorization.name;
}

export function renderHitl(intent: RenderIntent): HitlView {
  const request = intent.inputRequests?.[0];
  const authorizations = intent.authorizations ?? [];
  const notices: string[] = [];
  const rows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];

  if (request !== undefined) {
    notices.push(publicInputNotice(request));
    rows.push(...inputRows(intent, request, 0));
  }

  for (const [index, authorization] of authorizations.entries()) {
    if (rows.length >= MAX_ROWS) break;
    notices.push(
      `**Authorization required for <@${authorization.recipientUserId}>**\nConnect ${authorizationName(authorization)} to continue.`,
    );
    const current = rows.at(-1);
    const button: APIButtonComponent = {
      type: ComponentType.Button,
      custom_id: authCustomId(intent.dispatchId, intent.revision, index),
      label: sliceText(`Connect ${authorizationName(authorization)}`, 80),
      style: ButtonStyle.Primary,
    };
    if (
      current !== undefined &&
      current.components.length < 5 &&
      current.components.every((component) => component.type === ComponentType.Button)
    ) {
      rows[rows.length - 1] = {
        type: ComponentType.ActionRow,
        components: [...current.components, button],
      };
    } else {
      rows.push({ type: ComponentType.ActionRow, components: [button] });
    }
  }

  return {
    ...(notices.length === 0 ? {} : { notice: notices.join("\n\n") }),
    components: rows,
  };
}

/**
 * The same schema the wire contract declares `dispatchId` with, so a custom id
 * this bot minted is never rejected by a stricter local copy of the format.
 */
const dispatchId = z.uuid();

function isDispatchId(value: string | undefined): value is string {
  return dispatchId.safeParse(value).success;
}

function parseInputCustomId(customId: string): HitlLocator | undefined {
  const parts = customId.split(":");
  if (parts.length !== 6 || parts[0] !== "eve-hitl" || parts[1] !== "i") return undefined;
  const revision = Number(parts[3]);
  const requestIndex = Number(parts[4]);
  const encoded = parts[5];
  if (!isDispatchId(parts[2]) || !Number.isSafeInteger(revision) || revision < 1) return undefined;
  if (!Number.isSafeInteger(requestIndex) || requestIndex < 0) return undefined;

  if (encoded === "f" || encoded === "m") {
    return {
      kind: "input",
      dispatchId: parts[2],
      revision,
      requestIndex,
      action: encoded === "f" ? "freeform" : "modal",
    };
  }
  const match = /^([os])(\d+)$/u.exec(encoded ?? "");
  if (match === null) return undefined;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  return {
    kind: "input",
    dispatchId: parts[2],
    revision,
    requestIndex,
    action: match[1] === "o" ? "option" : "select",
    index,
  };
}

export function parseLocator(customId: string): HitlLocator | undefined {
  return parseInputCustomId(customId) ?? parseAuthorizationCustomId(customId);
}

function parseAuthorizationCustomId(customId: string): HitlLocator | undefined {
  const parts = customId.split(":");
  if (parts.length !== 5 || parts[0] !== "eve-hitl" || parts[1] !== "a") return undefined;
  const revision = Number(parts[3]);
  const authorizationIndex = Number(parts[4]);
  if (!isDispatchId(parts[2]) || !Number.isSafeInteger(revision) || revision < 1) return undefined;
  if (!Number.isSafeInteger(authorizationIndex) || authorizationIndex < 0) return undefined;
  return {
    kind: "authorization",
    dispatchId: parts[2],
    revision,
    authorizationIndex,
  };
}

export function modalCustomId(locator: Extract<HitlLocator, { readonly kind: "input" }>): string {
  return inputCustomId(locator.dispatchId, locator.revision, locator.requestIndex, "m");
}
