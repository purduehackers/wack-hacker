import type { RedisClient } from "@/lib/redis/client";

import { createRedis } from "@/lib/redis/client";

import type { ContextSnapshot } from "./types";

export type { ContextSnapshot, ToolDefSnapshot } from "./types";

const TTL = 60 * 60;

export class ContextSnapshotStore {
  constructor(private redis: RedisClient = createRedis()) {}

  private key(channelId: string, threadId?: string): string {
    return `context-snapshot:${threadId ?? channelId}`;
  }

  async get(channelId: string, threadId?: string): Promise<ContextSnapshot | null> {
    return this.redis.get<ContextSnapshot>(this.key(channelId, threadId));
  }

  async set(
    channelId: string,
    threadId: string | undefined,
    snapshot: ContextSnapshot,
  ): Promise<void> {
    await this.redis.set(this.key(channelId, threadId), snapshot, { ex: TTL });
  }

  async delete(channelId: string, threadId?: string): Promise<void> {
    await this.redis.del(this.key(channelId, threadId));
  }
}
