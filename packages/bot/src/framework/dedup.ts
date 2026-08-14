/**
 * Redis-backed deduplication.
 *
 * A `SET NX PX` is the whole mechanism: the first caller to claim a key wins and
 * everyone after it is told no, until the key expires.
 *
 * The five-minute TTL carries over from the prior implementation and is a
 * deliberate trade-off, not a guess. Long enough to cover a gateway `RESUME`
 * replay and the overlap window when two deployments briefly both hold a
 * connection. Short enough that the keyspace stays bounded without any
 * sweeping.
 *
 * It fails **closed**. This claim is load-bearing during overlapping Sandbox
 * generations: executing nothing is recoverable, while executing a mutation
 * twice is not. The structured error is an operational alert.
 */

import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { z } from "zod";

import type { Deduplicator } from "./events.ts";

const DEDUP_TTL_MS = 300_000;

/**
 * `z.number()` rejects the non-finite doubles that `typeof` still calls
 * numbers, so the union matches `NaN` and both infinities alongside it.
 * Without them `failureTypeOf` would report a non-finite rejection as an
 * object.
 */
const numberSchema = z.union([
  z.number(),
  z.nan(),
  z.literal(Number.POSITIVE_INFINITY),
  z.literal(Number.NEGATIVE_INFINITY),
]);

const stringSchema = z.string();
const booleanSchema = z.boolean();
const bigintSchema = z.bigint();
const symbolSchema = z.symbol();
const functionSchema = z.function();

/**
 * The name this alert has always carried for a non-`Error` rejection.
 *
 * The vocabulary is `typeof`'s, because operators grep for these exact words.
 * The function derives it from positive tests over the disjoint primitive sets
 * instead.
 * `null` is not special-cased on purpose — `typeof null` is `"object"`, and the
 * final fallthrough reports every remaining value, `null` included, as one.
 */
function failureTypeOf(cause: unknown): string {
  if (cause === undefined) return "undefined";
  if (stringSchema.safeParse(cause).success) return "string";
  if (booleanSchema.safeParse(cause).success) return "boolean";
  if (numberSchema.safeParse(cause).success) return "number";
  if (bigintSchema.safeParse(cause).success) return "bigint";
  if (symbolSchema.safeParse(cause).success) return "symbol";
  if (functionSchema.safeParse(cause).success) return "function";
  return "object";
}

/**
 * Builds the `Deduplicator` the event router consults before it runs a
 * handler. `claim` answers true only for the first holder of a key. It fails
 * closed: a Redis outage reads as "already claimed", because a skipped event
 * is recoverable and a doubled mutation is not.
 */
export function createDeduplicator(redis: RedisClient): Deduplicator {
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
            failureType:
              claimed.error instanceof Error ? claimed.error.name : failureTypeOf(claimed.error),
          }),
        );
        return false;
      }

      // Upstash answers "OK" on a successful NX set and null when the key existed.
      return claimed.value === "OK";
    },
  };
}
