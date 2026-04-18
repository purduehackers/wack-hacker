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

export interface RedisLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
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
