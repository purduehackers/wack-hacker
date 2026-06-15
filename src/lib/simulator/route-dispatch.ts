import type { REST } from "@discordjs/rest";

import type { SimEventBus } from "./event-bus.ts";
import type { SimActionRow, SimEmbed } from "./types.ts";
import type { VirtualGuild } from "./virtual-guild.ts";

interface RestBody {
  content?: string;
  embeds?: SimEmbed[];
  components?: SimActionRow[];
}

interface RestRequestOptions {
  body?: unknown;
}

interface DispatcherOptions {
  /** Real REST to forward non-approval Discord tool calls to (LIVE only). */
  realRest?: REST;
  /** Enable passthrough of Discord domain-tool writes to the real server. */
  passthrough?: boolean;
}

interface DispatchCtx {
  guild: VirtualGuild;
  bus: SimEventBus;
  approvalByMessage: Map<string, string>;
}

const APPROVAL_CUSTOM_ID = /^tool-approval:(?:approve|deny):(.+)$/;
const CHANNEL_MESSAGES = /^\/channels\/([^/]+)\/messages$/;
const CHANNEL_MESSAGE = /^\/channels\/([^/]+)\/messages\/([^/?]+)$/;
const MESSAGE_REACTION = /^\/channels\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/]+)/;

const DECISION_PREFIX = "Wack Hack · Permission ";
const DECISION_LABELS: Record<string, "approved" | "denied" | "timeout"> = {
  Approved: "approved",
  Denied: "denied",
  "Timed Out": "timeout",
};

function findApprovalId(components?: SimActionRow[]): string | undefined {
  for (const row of components ?? []) {
    for (const button of row.components ?? []) {
      const match = button.custom_id?.match(APPROVAL_CUSTOM_ID);
      if (match) return match[1];
    }
  }
  return undefined;
}

/** Pull `{tool}` / `delegate_{name}.{tool}` out of the python-style call block. */
function parseToolName(description?: string): { toolName: string; delegateName?: string } {
  const line = description?.split("\n").find((l) => l.includes("("));
  const prefix = line?.split("(")[0]?.trim() ?? "";
  const delegated = prefix.match(/^delegate_([^.]+)\.(.+)$/);
  if (delegated) return { delegateName: delegated[1], toolName: delegated[2] };
  return { toolName: prefix || "unknown" };
}

function fieldValue(embed: SimEmbed | undefined, name: string): string | undefined {
  return embed?.fields?.find((f) => f.name === name)?.value;
}

function decisionStatus(embed?: SimEmbed): "approved" | "denied" | "timeout" | undefined {
  const name = embed?.author?.name ?? "";
  if (!name.startsWith(DECISION_PREFIX)) return undefined;
  return DECISION_LABELS[name.slice(DECISION_PREFIX.length)];
}

function handlePostMessages(ctx: DispatchCtx, channelId: string, body: RestBody): { id: string } {
  const approvalId = findApprovalId(body.components);
  const message = ctx.guild.createMessage(channelId, {
    authorId: ctx.guild.botUserId,
    authorKind: "bot",
    content: typeof body.content === "string" ? body.content : "",
    embeds: body.embeds,
    components: body.components,
    approvalId,
  });
  ctx.bus.emit({ type: "message.create", message });
  if (approvalId) {
    ctx.approvalByMessage.set(message.id, approvalId);
    const embed = body.embeds?.[0];
    const { toolName, delegateName } = parseToolName(embed?.description);
    ctx.bus.emit({
      type: "approval.prompt",
      approvalId,
      messageId: message.id,
      channelId,
      toolName,
      delegateName,
      reason: fieldValue(embed, "Reason") ?? "(not provided)",
      embed: embed ?? { description: "" },
      components: body.components ?? [],
    });
  }
  return { id: message.id };
}

function handlePatchMessage(
  ctx: DispatchCtx,
  channelId: string,
  messageId: string,
  body: RestBody,
): Record<string, never> {
  const message = ctx.guild.editMessage(channelId, messageId, {
    content: body.content,
    embeds: body.embeds,
    components: body.components,
  });
  ctx.bus.emit({
    type: "message.edit",
    messageId,
    channelId,
    content: message.content,
    embeds: message.embeds,
    components: message.components,
    editedAt: message.editedAt!,
  });
  const status = decisionStatus(body.embeds?.[0]);
  const approvalId = ctx.approvalByMessage.get(messageId);
  if (status && approvalId) {
    const decidedBy = fieldValue(body.embeds?.[0], "Decided by")?.match(/<@(\d+)>/)?.[1] ?? null;
    ctx.bus.emit({
      type: "approval.decision",
      approvalId,
      messageId,
      channelId,
      status,
      decidedByUserId: decidedBy,
      embed: body.embeds![0],
    });
  }
  return {};
}

function handleReaction(
  ctx: DispatchCtx,
  method: string,
  channelId: string,
  messageId: string,
  rawEmoji: string,
): Record<string, never> {
  const emoji = decodeURIComponent(rawEmoji);
  if (method === "PUT") {
    ctx.guild.addReaction(channelId, messageId, emoji, true);
    ctx.bus.emit({ type: "reaction.add", messageId, channelId, emoji, byBot: true });
  } else if (method === "DELETE") {
    ctx.guild.removeReaction(channelId, messageId, emoji, true);
    ctx.bus.emit({ type: "reaction.remove", messageId, channelId, emoji, byBot: true });
  }
  return {};
}

/**
 * Smart-proxy router for the `@discordjs/rest` surface that every Discord tool
 * and the approval runtime call through. Approval prompt/decision messages are
 * always virtualized (rendered in the sim, clickable). Other Discord writes are
 * virtual by default and forwarded to the real REST only when
 * `realDiscordTools` is set with a `realRest` (LIVE "real everything").
 */
export function createRouteDispatcher(
  guild: VirtualGuild,
  bus: SimEventBus,
  options: DispatcherOptions = {},
) {
  const ctx: DispatchCtx = { guild, bus, approvalByMessage: new Map() };

  function passthrough(
    method: string,
    route: string,
    requestOptions?: RestRequestOptions,
  ): Promise<unknown> | undefined {
    if (!options.passthrough || !options.realRest) return undefined;
    const body = (requestOptions?.body ?? {}) as RestBody;
    // Keep approval prompts and their converge edits virtual no matter what.
    const collectionMatch = route.match(CHANNEL_MESSAGES);
    if (collectionMatch && method === "POST" && findApprovalId(body.components)) return undefined;
    const singleMatch = route.match(CHANNEL_MESSAGE);
    if (singleMatch && ctx.approvalByMessage.has(singleMatch[2])) return undefined;
    const rest = options.realRest as unknown as Record<
      string,
      (route: string, opts?: RestRequestOptions) => Promise<unknown>
    >;
    return rest[method.toLowerCase()]?.call(options.realRest, route, requestOptions);
  }

  function dispatch(method: string, route: string, body: RestBody): unknown {
    const collectionMatch = route.match(CHANNEL_MESSAGES);
    if (collectionMatch && method === "POST")
      return handlePostMessages(ctx, collectionMatch[1], body);

    const singleMatch = route.match(CHANNEL_MESSAGE);
    if (singleMatch && method === "PATCH") {
      return handlePatchMessage(ctx, singleMatch[1], singleMatch[2], body);
    }
    if (singleMatch && method === "DELETE") {
      ctx.guild.deleteMessage(singleMatch[1], singleMatch[2]);
      ctx.bus.emit({
        type: "message.delete",
        messageId: singleMatch[2],
        channelId: singleMatch[1],
      });
      return {};
    }
    if (singleMatch && method === "GET") {
      return ctx.guild.getMessage(singleMatch[1], singleMatch[2]) ?? {};
    }

    const reaction = route.match(MESSAGE_REACTION);
    if (reaction) return handleReaction(ctx, method, reaction[1], reaction[2], reaction[3]);

    // Unknown read → empty stub; unknown write → plausible id so the caller continues.
    if (method === "GET") return {};
    return { id: guild.nextId() };
  }

  async function handle(
    method: string,
    route: string,
    requestOptions?: RestRequestOptions,
  ): Promise<unknown> {
    const forwarded = passthrough(method, route, requestOptions);
    if (forwarded) return forwarded;
    return dispatch(method, route, (requestOptions?.body ?? {}) as RestBody);
  }

  return { handle };
}
