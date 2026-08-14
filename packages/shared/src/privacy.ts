/**
 * Who asked us not to publish them.
 *
 * Purdue Hackers builds in public by default, so this stores only the
 * exceptions: membership means "do not upload this person's content anywhere
 * outside Discord". Absence is the default, and the set stores nothing for it.
 *
 * A Redis set is the whole data structure. `sismember` is one round trip, and
 * `sadd`/`srem` are atomic, so a toggle cannot be lost to a concurrent write.
 * That matters more than it looks: during a Sandbox rotation two bot
 * generations briefly overlap. Read-modify-write over a JSON list would be
 * lossy exactly then. It also lands immediately, with no propagation window
 * between someone opting out and the mirror of their next message.
 *
 * This is deliberately *not* a deletion mechanism. Opting out stops future
 * uploads. Anything already public stays until someone removes it by hand.
 */

import type { RedisClient } from "./redis/client.ts";

const OPTED_OUT_KEY = "wack:privacy:opted-out:v1";

/** True when this user opted out of publication. */
export async function isOptedOut(redis: RedisClient, userId: string): Promise<boolean> {
  return (await redis.sismember(OPTED_OUT_KEY, userId)) === 1;
}

/** Idempotent: opting out twice is the same as once. */
export async function optOut(redis: RedisClient, userId: string): Promise<void> {
  await redis.sadd(OPTED_OUT_KEY, userId);
}

/**
 * Returns the user to the build-in-public default, so future uploads include
 * them again. Idempotent, and it uploads nothing retroactively.
 */
export async function optIn(redis: RedisClient, userId: string): Promise<void> {
  await redis.srem(OPTED_OUT_KEY, userId);
}
