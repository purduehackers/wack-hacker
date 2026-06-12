import type { API } from "@discordjs/core/http-only";

import type { ChatMessage, SerializedAgentContext, TurnUsage } from "@/lib/ai/types";

import type { ConversationStore } from "./store";

export interface HandlerContext {
  discord: API;
  store: ConversationStore;
  botUserId: string;
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
 * Join from a Discord message id back to the exact turn/trajectory that
 * produced it. The turn's trace id is already printed in the bot message
 * footer and `chat.discord_message_id` is already a span attribute — this
 * record is the reverse lookup, written at finalize time and consumed by the
 * feedback reaction handler.
 */
export interface TurnMessageRecord {
  /** Chat workflow run id (`chat.id` on spans/wide events); absent outside chat workflows. */
  chatId?: string;
  /** OTEL trace id for the turn — the same id rendered in the reply footer. */
  traceId?: string;
  /** Subagent domains that ran during the turn, deduplicated. */
  domains: string[];
  channelId: string;
  /** Discord user id of the person whose message triggered the turn. */
  userId: string;
}

/**
 * Per-turn snapshot of everything the orchestrator receives. Written by the
 * chat workflow after each turn completes; read by the /Inspect Context message
 * command. Stored under a separate Redis key from `ConversationState` to keep
 * the hot-path state lean.
 *
 * `totalUsage` is cumulative across every turn the workflow has run so far —
 * it answers "what has this conversation cost in total?" — not just the most
 * recent turn.
 */
export interface ContextSnapshot {
  model: string;
  context: SerializedAgentContext;
  systemPrompt: string;
  tools: ToolDefSnapshot[];
  messages: ChatMessage[];
  totalUsage: TurnUsage;
  turnCount: number;
  updatedAt: string;
}
