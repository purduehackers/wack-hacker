/**
 * Upstash Redis access.
 *
 * `RedisClient` is a `Pick` of the upstream `Redis` surface rather than a
 * hand-written "redis-like" interface. A signature change in `@upstash/redis`
 * is then a compile error here instead of a runtime failure in production.
 * The `Pick` also keeps the surface a caller may reach for narrow:
 * each transition module further narrows it to the commands it actually issues.
 *
 * `eval` is in the set because two operations need atomicity that plain
 * commands cannot express. One releases a lock only if we still hold it. The
 * other is the compare-and-delete used when tearing down conversation state.
 *
 * The list commands back the bot's per-conversation pending queue. eve does not
 * keep a durable FIFO of user messages for a session, so ordering bursts is the
 * bot's job. A Redis list is the smallest thing that survives a restart.
 */

import { Redis } from "@upstash/redis";
import type { RedisConfigNodejs } from "@upstash/redis";

export type RedisClient = Pick<
  Redis,
  | "get"
  | "set"
  | "del"
  | "expire"
  | "eval"
  | "incrby"
  | "sadd"
  | "smembers"
  | "srem"
  | "scard"
  | "sismember"
  | "exists"
  | "pttl"
  | "pipeline"
  | "rpush"
  | "lpop"
  | "llen"
  | "ltrim"
>;

type RedisConfig = Readonly<{
  [K in "token" | "url"]: NonNullable<RedisConfigNodejs[K]>;
}>;

let cached: RedisClient | undefined;

/**
 * Process-wide client, memoized so repeated store construction does not rebuild
 * the HTTP client.
 *
 * The prior implementation called `Redis.fromEnv()`, which reads either
 * `UPSTASH_REDIS_REST_*` or `KV_REST_API_*`. That flexibility hid a real
 * inconsistency: its budget module gated on the former while its env schema
 * declared the latter. It worked only because `fromEnv` accepts both.
 * Config is explicit here so one place settles the names.
 */
export function getRedis(config: RedisConfig): RedisClient {
  cached ??= new Redis({ url: config.url, token: config.token });
  return cached;
}
