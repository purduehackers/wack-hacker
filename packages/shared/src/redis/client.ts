/**
 * Upstash Redis access.
 *
 * `RedisClient` is a `Pick` of the upstream `Redis` surface rather than a
 * hand-written "redis-like" interface, so a signature change in
 * `@upstash/redis` is a compile error here instead of a runtime failure in
 * production. Tests implement this same type with an in-memory fake — no
 * module mocking required, which is the doctrine the legacy suite enforced.
 *
 * `eval` is in the set because two operations need atomicity that plain
 * commands cannot express: releasing a lock only if we still hold it, and the
 * compare-and-delete used when tearing down conversation state.
 */

import { Redis } from "@upstash/redis";

export type RedisClient = Pick<
  Redis,
  "get" | "set" | "del" | "expire" | "eval" | "incrby" | "sadd" | "smembers" | "srem" | "pipeline"
>;

export interface RedisConfig {
  readonly url: string;
  readonly token: string;
}

let cached: RedisClient | undefined;

/**
 * Process-wide client, memoized so repeated store construction does not rebuild
 * the HTTP client.
 *
 * The legacy app called `Redis.fromEnv()`, which reads either
 * `UPSTASH_REDIS_REST_*` or `KV_REST_API_*`. That flexibility hid a real
 * inconsistency: its budget module gated on the former while its env schema
 * declared the latter, and it worked only because `fromEnv` accepts both.
 * Config is explicit here so the names are settled in one place.
 */
export function getRedis(config: RedisConfig): RedisClient {
  cached ??= new Redis({ url: config.url, token: config.token });
  return cached;
}

/** Drops the memoized client. Tests only. */
export function resetRedisForTest(): void {
  cached = undefined;
}
