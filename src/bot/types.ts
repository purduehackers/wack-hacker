import type { API } from "@discordjs/core/http-only";

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
