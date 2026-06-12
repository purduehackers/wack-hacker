import type { RedisClient } from "@/lib/redis/client";

import { createRedis } from "@/lib/redis/client";

import type { StoredContextSnapshot } from "./types";

export type { ContextSnapshot, StoredContextSnapshot, ToolDefSnapshot } from "./types";

const TTL = 60 * 60;

export class ContextSnapshotStore {
  constructor(private redis: RedisClient = createRedis()) {}

  private key(channelId: string, threadId?: string): string {
    return `context-snapshot:${threadId ?? channelId}`;
  }

  async get(channelId: string, threadId?: string): Promise<StoredContextSnapshot | null> {
    return this.redis.get<StoredContextSnapshot>(this.key(channelId, threadId));
  }

  async set(
    channelId: string,
    threadId: string | undefined,
    snapshot: StoredContextSnapshot,
  ): Promise<void> {
    await this.redis.set(this.key(channelId, threadId), snapshot, { ex: TTL });
  }

  async delete(channelId: string, threadId?: string): Promise<void> {
    await this.redis.del(this.key(channelId, threadId));
  }
}
