import type { RedisClient } from "@/lib/redis/client";

import { createRedis } from "@/lib/redis/client";

import type { TurnMessageRecord } from "./types";

export type { TurnMessageRecord } from "./types";

const TTL = 7 * 24 * 60 * 60;

/**
 * Discord-message-id → turn index. This is the join from a message id back to
 * the exact turn/trajectory that produced it: the trace id is already printed
 * in the bot message footer and `chat.discord_message_id` is already a span
 * attribute — this store closes the reverse direction so a reaction on a bot
 * reply resolves to its turn.
 */
export class TurnMessageStore {
  constructor(private redis: RedisClient = createRedis()) {}

  private key(messageId: string): string {
    return `turn-message:${messageId}`;
  }

  async get(messageId: string): Promise<TurnMessageRecord | null> {
    return this.redis.get<TurnMessageRecord>(this.key(messageId));
  }

  async set(messageId: string, record: TurnMessageRecord): Promise<void> {
    await this.redis.set(this.key(messageId), record, { ex: TTL });
  }
}
