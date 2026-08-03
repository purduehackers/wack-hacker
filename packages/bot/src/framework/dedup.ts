/**
 * Redis-backed deduplication.
 *
 * A `SET NX PX` is the whole mechanism: the first caller to claim a key wins and
 * everyone after it is told no, until the key expires.
 *
 * The five-minute TTL is carried over from the legacy app and is a deliberate
 * trade-off, not a guess. Long enough to cover a gateway `RESUME` replay and the
 * overlap window when two deployments briefly both hold a connection; short
 * enough that the keyspace stays bounded without any sweeping.
 *
 * It fails **open**. If Redis is unreachable, the claim is granted and the
 * handler runs — a duplicate reaction is a far better outcome than a bot that
 * stops responding because its dedup store is down.
 */

import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import type { Deduplicator } from "./events.ts";

const DEDUP_TTL_MS = 300_000;

export function createDeduplicator(redis: RedisClient): Deduplicator {
  return {
    claim: async (key: string) => {
      const claimed = await Result.tryPromise({
        try: () => redis.set(`dedup:${key}`, "1", { nx: true, px: DEDUP_TTL_MS }),
        catch: (cause) => cause,
      });

      // Fail open: an unreachable store must not silence the bot.
      if (Result.isError(claimed)) return true;

      // Upstash answers "OK" on a successful NX set and null when the key existed.
      return claimed.value === "OK";
    },
  };
}

/**
 * In-memory deduplication, for a single process with no Redis configured.
 *
 * Loses its state on restart, which is exactly when duplicates are most likely,
 * so it is a development convenience rather than a substitute.
 */
export function createMemoryDeduplicator(now: () => number = () => Date.now()): Deduplicator {
  const seen = new Map<string, number>();

  return {
    claim: async (key: string) => {
      const currentTime = now();
      // Opportunistic sweep: without it the map grows for the life of the process.
      for (const [existing, expiresAt] of seen) {
        if (expiresAt <= currentTime) seen.delete(existing);
      }

      if (seen.has(key)) return false;
      seen.set(key, currentTime + DEDUP_TTL_MS);
      return true;
    },
  };
}
