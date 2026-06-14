import type { RedisClient } from "@/lib/redis/client";

import { withSpan } from "@/lib/otel/tracing";
import { createRedis } from "@/lib/redis/client";

import type { TurnMessageRecord } from "./types";

export type { TurnMessageRecord } from "./types";

// A week: long enough that feedback reactions on an old reply still resolve,
// short enough to bound the keyspace for a low-volume bot.
const TTL = 7 * 24 * 60 * 60;

/**
 * Discord-message-id → turn index. Closes the reverse direction of the trace
 * already printed in a reply footer: a reaction on a bot reply resolves to the
 * turn (and trace) that produced it. Written at finalize time for the primary
 * reply and every overflow chunk; read by the feedback reaction handler.
 */
export class TurnMessageStore {
  constructor(private redis: RedisClient = createRedis()) {}

  private key(messageId: string): string {
    return `turn-message:${messageId}`;
  }

  async get(messageId: string): Promise<TurnMessageRecord | null> {
    return withSpan("redis.turn_message.get", { "redis.key_pattern": "turn-message" }, () =>
      this.redis.get<TurnMessageRecord>(this.key(messageId)),
    );
  }

  async set(messageId: string, record: TurnMessageRecord): Promise<void> {
    await withSpan("redis.turn_message.set", { "redis.key_pattern": "turn-message" }, () =>
      this.redis.set(this.key(messageId), record, { ex: TTL }),
    );
  }
}
