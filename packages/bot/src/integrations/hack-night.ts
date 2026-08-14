/**
 * Hack night event identity.
 *
 * Every hack night has a slug — `hack-night-YYYY-MM-DD`, dated to the Friday
 * it started. Photos uploaded during the night land under that slug in the
 * CMS. The slug is the join key between a Discord thread and its photo
 * archive.
 *
 * This module stores the slug rather than recomputing it. The cleanup job runs
 * on Sunday and would otherwise have to work backwards to Friday's date. That
 * derivation is still there as a fallback, but a stored slug is authoritative.
 * If a hack night ran late and crossed midnight, only the stored value is
 * right.
 *
 * The seven-day TTL comfortably outlives the Friday-to-Sunday window while
 * keeping the keyspace bounded.
 */

import { messageOf, Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import { calendarDate } from "../utils/dates.ts";

const THREAD_SLUG_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Builds the `hack-night-YYYY-MM-DD` slug for the given date. The date must be
 * the Friday the event started, because the slug is the join key to the CMS
 * photo archive.
 */
export function generateEventSlug(date: Date): string {
  const { year, month, day } = calendarDate(date);
  return `hack-night-${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ThreadSlugStore {
  readonly set: (threadId: string, slug: string) => Promise<Result<undefined, Transient>>;
  readonly get: (threadId: string) => Promise<Result<string | undefined, Transient>>;
}

/**
 * Redis-backed thread-to-slug store with a seven-day TTL, so entries outlive
 * the Friday-to-Sunday cleanup window and then expire on their own. Redis
 * failures surface as `Transient` results, never as throws.
 */
export function createThreadSlugStore(redis: RedisClient): ThreadSlugStore {
  const key = (threadId: string) => `hack-night-thread:${threadId}`;

  return {
    set: async (threadId, slug) =>
      Result.tryPromise({
        try: async () => {
          await redis.set(key(threadId), slug, { ex: THREAD_SLUG_TTL_SECONDS });
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "store hack night slug",
            detail: messageOf(cause),
          }),
      }),

    get: async (threadId) =>
      Result.tryPromise({
        try: async () => (await redis.get<string>(key(threadId))) ?? undefined,
        catch: (cause) =>
          new Transient({
            operation: "read hack night slug",
            detail: messageOf(cause),
          }),
      }),
  };
}

/**
 * The stored slug, or one derived from the fallback date.
 *
 * Falls back rather than failing: on a missing key the archive lookup uses the
 * most likely slug, which beats abandoning cleanup entirely.
 */
export async function resolveEventSlug(
  store: ThreadSlugStore,
  threadId: string,
  fallback: Date,
): Promise<string> {
  const lookup = await store.get(threadId);
  if (Result.isError(lookup)) return generateEventSlug(fallback);
  return lookup.value ?? generateEventSlug(fallback);
}
