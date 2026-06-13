import type { API } from "@discordjs/core/http-only";

import type { ChatMessage, SerializedAgentContext, TurnUsage } from "@/lib/ai/types";

import type { ConversationStore } from "./store";

export interface HandlerContext {
  discord: API;
  store: ConversationStore;
  botUserId: string;
  /**
   * Set by `EventRouter.dispatch` for message packets: true when the message
   * leads with an @-mention of the bot. Computed once in the router so
   * handlers don't re-derive it.
   */
  isBotMention?: boolean;
}

export interface ConversationState {
  workflowRunId: string;
  channelId: string;
  threadId?: string;
  startedAt: string;
}

/**
 * Serialized tool definition captured at snapshot time. Mirrors the tool-surface
 * shape the orchestrator exposes to the AI SDK (name, description, JSON-schema
 * input). Stored verbatim so the inspector can render and measure exactly what
 * the model sees.
 */
export interface ToolDefSnapshot {
  name: string;
  description: string;
  inputSchema: unknown;
}

/**
 * The slice of a context snapshot the chat workflow persists after each turn.
 * Only the cheap dynamic state lives in Redis; the expensive derived view
 * (system prompt, materialized tool schemas) is rebuilt on demand by the
 * /Inspect Context read path via `buildContextSnapshot`. Stored under a
 * separate Redis key from `ConversationState` to keep the hot-path state lean.
 *
 * `totalUsage` is cumulative across every turn the workflow has run so far —
 * it answers "what has this conversation cost in total?" — not just the most
 * recent turn.
 */
export interface StoredContextSnapshot {
  context: SerializedAgentContext;
  messages: ChatMessage[];
  totalUsage: TurnUsage;
  turnCount: number;
  updatedAt: string;
}

/**
 * Full per-turn snapshot of everything the orchestrator receives: the stored
 * slice plus the orchestrator-derived view, rebuilt at read time with the
 * same code paths the orchestrator runs with.
 */
export interface ContextSnapshot extends StoredContextSnapshot {
  model: string;
  systemPrompt: string;
  tools: ToolDefSnapshot[];
}
