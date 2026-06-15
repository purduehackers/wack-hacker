/**
 * Wire + domain types for the Discord chat simulator. Everything the browser
 * UI and the backend share lives here so the SSE contract has one source of
 * truth. `SimEmbed`/`SimButton`/`SimActionRow` are deliberately loose mirrors
 * of the `discord-api-types` shapes the bot already builds (the fake REST
 * passes tool/approval payloads through verbatim).
 */

import type { UserRole } from "@/lib/ai/constants";
import type { ChatMessage, SerializedAgentContext } from "@/lib/ai/types";

export interface SimEmbedAuthor {
  name: string;
  icon_url?: string;
}

export interface SimEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface SimEmbed {
  title?: string;
  description?: string;
  color?: number;
  author?: SimEmbedAuthor;
  fields?: SimEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface SimButtonEmoji {
  name?: string;
  id?: string;
  animated?: boolean;
}

/** A Discord button (ComponentType.Button === 2). */
export interface SimButton {
  type: 2;
  style: number;
  label?: string;
  emoji?: SimButtonEmoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

/** A Discord action row (ComponentType.ActionRow === 1). */
export interface SimActionRow {
  type: 1;
  components: SimButton[];
}

export interface SimReaction {
  emoji: string;
  count: number;
  me: boolean;
}

/** One message in a virtual channel, as the UI renders it. */
export interface SimMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorKind: "bot" | "user";
  content: string;
  embeds: SimEmbed[];
  components: SimActionRow[];
  reactions: SimReaction[];
  createdAt: string;
  editedAt?: string;
  /** Set for interaction follow-ups posted with the ephemeral flag (64). */
  ephemeral?: boolean;
  /** Set when this message is a tool-approval prompt, so the UI can wire its buttons. */
  approvalId?: string;
}

export interface VirtualChannel {
  id: string;
  name: string;
  kind: "channel" | "thread";
  parentId?: string;
}

export interface VirtualMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  bot?: boolean;
  roles: string[];
}

export interface VirtualRole {
  id: string;
  name: string;
  color?: string;
}

export interface VirtualEmoji {
  id: string;
  name: string;
  animated: boolean;
  url?: string;
}

/** Full virtual-server state, for mention resolution + reconnect hydration. */
export interface VirtualGuildSnapshot {
  guildId: string;
  botUserId: string;
  channels: VirtualChannel[];
  members: VirtualMember[];
  roles: VirtualRole[];
  emojis: VirtualEmoji[];
  messages: SimMessage[];
}

export interface SimUsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  stepCount: number;
  toolNames: string[];
}

/** One context-budget category (system prompt, tools, history, …) for the inspector. */
export interface SimContextCategory {
  label: string;
  chars: number;
  estimatedTokens: number;
  items?: { name: string; estimatedTokens: number }[];
}

/**
 * A render-ready view of everything the model saw for the conversation — the
 * inspector's "Context" tab. Built backend-side from the real
 * `buildContextSnapshot` + `breakdownFromSnapshot` so it matches `/inspect-context`.
 */
export interface SimContextSnapshot {
  model: string;
  systemPrompt: string;
  tools: { name: string; description: string }[];
  context: SerializedAgentContext;
  messages: ChatMessage[];
  categories: SimContextCategory[];
  estimatedInputTokens: number;
  totalUsage: SimUsageSummary;
  turnCount: number;
  totalCostUsd?: { input: number; output: number; total: number };
}

interface SimEventBase {
  /** Monotonic per run — gives the UI a total order for replay. */
  seq: number;
  ts: number;
  runId: string;
}

/**
 * The SSE wire contract. `message.*` carry exactly what the bot sent to
 * Discord (captured at the two transports); `approval.*` are derived
 * convenience events emitted alongside the raw `message.*` so the buttons get
 * their `approvalId` without the UI re-parsing embeds.
 */
export type SimEvent =
  | (SimEventBase & { type: "guild.sync"; guild: VirtualGuildSnapshot })
  | (SimEventBase & {
      type: "run.start";
      turnIndex: number;
      channelId: string;
      threadId?: string;
    })
  | (SimEventBase & {
      type: "run.finish";
      turnIndex: number;
      discordMessageId: string;
      model: string;
      text: string;
      usage: SimUsageSummary;
    })
  | (SimEventBase & { type: "run.error"; message: string; traceId?: string })
  | (SimEventBase & { type: "message.create"; message: SimMessage })
  | (SimEventBase & {
      type: "message.edit";
      messageId: string;
      channelId: string;
      content?: string;
      embeds?: SimEmbed[];
      components?: SimActionRow[];
      editedAt: string;
    })
  | (SimEventBase & { type: "message.delete"; messageId: string; channelId: string })
  | (SimEventBase & {
      type: "reaction.add";
      messageId: string;
      channelId: string;
      emoji: string;
      byBot: boolean;
    })
  | (SimEventBase & {
      type: "reaction.remove";
      messageId: string;
      channelId: string;
      emoji: string;
      byBot: boolean;
    })
  | (SimEventBase & {
      type: "channel.create";
      channelId: string;
      name: string;
      kind: "channel" | "thread";
      parentId?: string;
      /** The parent-channel message a thread branched from (its starter). */
      starterMessageId?: string;
    })
  | (SimEventBase & {
      type: "approval.prompt";
      approvalId: string;
      messageId: string;
      channelId: string;
      toolName: string;
      delegateName?: string;
      reason: string;
      embed: SimEmbed;
      components: SimActionRow[];
    })
  | (SimEventBase & {
      type: "approval.decision";
      approvalId: string;
      messageId: string;
      channelId: string;
      status: "approved" | "denied" | "timeout";
      decidedByUserId: string | null;
      embed: SimEmbed;
    })
  | (SimEventBase & { type: "context.snapshot"; snapshot: SimContextSnapshot })
  | (SimEventBase & {
      type: "trace.tool";
      toolCallId: string;
      toolName: string;
      delegateName?: string;
      phase: "start" | "result" | "error";
      preliminary?: boolean;
    });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A `SimEvent` minus the fields {@link SimEventBus} stamps on `emit()`. */
export type EmittableEvent = DistributiveOmit<SimEvent, "seq" | "ts" | "runId">;

/** Body of `POST /api/simulator/chat`. */
export interface SimChatRequest {
  sessionId: string;
  content: string;
  role: UserRole;
  username?: string;
  nickname?: string;
  channelName?: string;
  /**
   * When the message is sent from inside an existing thread, its id — the bot
   * keeps replying there. Omitted for a base-channel message.
   */
  threadId?: string;
  /**
   * For a base-channel message: open a thread for the reply (the real bot's
   * behavior on a channel mention). Defaults to true. Ignored when `threadId`
   * is set.
   */
  openThread?: boolean;
}

/** Body of `POST /api/simulator/approve`. */
export interface SimApproveRequest {
  sessionId: string;
  approvalId: string;
  decision: "approve" | "deny";
  clickerUserId?: string;
  clickerRoles?: string[];
}
