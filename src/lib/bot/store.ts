import { Redis } from "@upstash/redis";

import type { ConversationState, RedisLike } from "./types";

export type { ConversationState, RedisLike } from "./types";

const TTL = 60 * 60;
const DEDUP_TTL_MS = 5 * 60 * 1000;
const LOCK_TTL_MS = 30 * 1000;

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export class ConversationStore {
  private redis: RedisLike;

  constructor(redis?: RedisLike) {
    this.redis = redis ?? Redis.fromEnv();
  }

  private key(channelId: string, threadId?: string): string {
    return `conversation:${threadId ?? channelId}`;
  }

  async get(channelId: string, threadId?: string): Promise<ConversationState | null> {
    return this.redis.get<ConversationState>(this.key(channelId, threadId));
  }

  async set(state: ConversationState): Promise<void> {
    await this.redis.set(this.key(state.channelId, state.threadId), state, { ex: TTL });
  }

  async delete(channelId: string, threadId?: string): Promise<void> {
    await this.redis.del(this.key(channelId, threadId));
  }

  async touch(channelId: string, threadId?: string): Promise<void> {
    await this.redis.expire(this.key(channelId, threadId), TTL);
  }

  /** Atomic dedup — returns true if this key hasn't been seen in the TTL window. */
  async dedup(key: string, ttlMs = DEDUP_TTL_MS): Promise<boolean> {
    const result = await this.redis.set(`dedup:${key}`, 1, { nx: true, px: ttlMs });
    return result !== null;
  }

  /** Atomic lock — returns a token if acquired, null if already held. */
  async acquireLock(key: string, ttlMs = LOCK_TTL_MS): Promise<string | null> {
    const token = crypto.randomUUID();
    const result = await this.redis.set(`lock:${key}`, token, { nx: true, px: ttlMs });
    return result !== null ? token : null;
  }

  /** Release a lock only if the token matches (Lua script, atomic). */
  async releaseLock(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, [`lock:${key}`], [token]);
  }
}
