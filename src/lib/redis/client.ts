import { Redis } from "@upstash/redis";

import type { RedisClient } from "./types";

export type { RedisClient } from "./types";

let cached: RedisClient | undefined;

/**
 * Return a process-wide Redis client built from `UPSTASH_REDIS_REST_*` env
 * vars. Mirrors `createDiscordAPI()` in shape. Memoized so repeated calls
 * inside store constructors don't re-parse the env and rebuild a client.
 */
export function createRedis(): RedisClient {
  return (cached ??= Redis.fromEnv() as unknown as RedisClient);
}

/** Reset the memoized client. Tests only — production paths must not call this. */
export function __resetRedisForTests(): void {
  cached = undefined;
}
