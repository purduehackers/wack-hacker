import type { Redis } from "@upstash/redis";

/**
 * The subset of `@upstash/redis`'s `Redis` surface our code depends on. Derived
 * via `Pick` so upstream signature changes surface as compile errors rather
 * than runtime failures. Tests implement this same surface via
 * `createMemoryRedis()` — no hand-rolled "like" interface required.
 */
export type RedisClient = Pick<
  Redis,
  "get" | "set" | "del" | "expire" | "eval" | "sadd" | "smembers" | "srem" | "pipeline"
>;
