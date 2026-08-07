/**
 * Redis-backed deduplication.
 *
 * A `SET NX PX` is the whole mechanism: the first caller to claim a key wins and
 * everyone after it is told no, until the key expires.
 *
 * The five-minute TTL is carried over from the prior implementation and is a deliberate
 * trade-off, not a guess. Long enough to cover a gateway `RESUME` replay and the
 * overlap window when two deployments briefly both hold a connection; short
 * enough that the keyspace stays bounded without any sweeping.
 *
 * It fails **closed**. This claim is load-bearing during overlapping Sandbox
 * generations: executing nothing is recoverable, while executing a mutation
 * twice is not. The structured error is an operational alert.
 */

import { Result } from "@repo/shared/result";

import type { Deduplicator } from "./events.ts";

export const DEDUP_TTL_MS = 300_000;

/** The one Redis operation deduplication needs, kept narrow for strict fakes. */
export interface DedupStore {
  readonly set: (
    key: string,
    value: string,
    options: { readonly nx: true; readonly px: number },
  ) => Promise<unknown>;
}

export function createDeduplicator(redis: DedupStore): Deduplicator {
  return {
    claim: async (key: string) => {
      const claimed = await Result.tryPromise({
        try: () => redis.set(`dedup:${key}`, "1", { nx: true, px: DEDUP_TTL_MS }),
        catch: (cause) => cause,
      });

      if (Result.isError(claimed)) {
        console.error(
          JSON.stringify({
            event: "discord.dedup.unavailable",
            key,
            failureType: claimed.error instanceof Error ? claimed.error.name : typeof claimed.error,
          }),
        );
        return false;
      }

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
