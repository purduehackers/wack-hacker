/**
 * Hack night event identity.
 *
 * Every hack night has a slug — `hack-night-YYYY-MM-DD`, dated to the Friday it
 * started — and photos uploaded during the night are filed under it in the CMS.
 * The slug is the join key between a Discord thread and its photo archive.
 *
 * It is stored rather than recomputed because the cleanup job runs on Sunday and
 * would otherwise have to work backwards to Friday's date. That derivation is
 * still there as a fallback, but a stored slug is authoritative: if a hack night
 * ran late and crossed midnight, only the stored value is right.
 *
 * The seven-day TTL comfortably outlives the Friday-to-Sunday window while
 * keeping the keyspace bounded.
 */

import { Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

const THREAD_SLUG_TTL_SECONDS = 7 * 24 * 60 * 60;

export function generateEventSlug(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `hack-night-${year}-${month}-${day}`;
}

/**
 * The Friday of the hack night week containing `date`.
 *
 * `(day + 2) % 7` maps Sunday to 2 and Saturday to 1, so both weekend days walk
 * back to the Friday that started the event rather than forward to the next one.
 */
export function fridayOf(date: Date): Date {
  const friday = new Date(date);
  friday.setDate(date.getDate() - ((date.getDay() + 2) % 7));
  return friday;
}

export interface ThreadSlugStore {
  readonly set: (threadId: string, slug: string) => Promise<Result<undefined, Transient>>;
  readonly get: (threadId: string) => Promise<Result<string | undefined, Transient>>;
}

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
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      }),

    get: async (threadId) =>
      Result.tryPromise({
        try: async () => (await redis.get<string>(key(threadId))) ?? undefined,
        catch: (cause) =>
          new Transient({
            operation: "read hack night slug",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  };
}

/**
 * The stored slug, or one derived from the fallback date.
 *
 * Falls back rather than failing: a missing key means the archive is looked up
 * under the most likely slug, which beats abandoning cleanup entirely.
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
