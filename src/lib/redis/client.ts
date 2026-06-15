import { Redis } from "@upstash/redis";

import type { RedisClient } from "./types";

export type { RedisClient } from "./types";

let cached: RedisClient | undefined;
let override: RedisClient | undefined;

/**
 * Return a process-wide Redis client built from `UPSTASH_REDIS_REST_*` env
 * vars. Mirrors `createDiscordAPI()` in shape. Memoized so repeated calls
 * inside store constructors don't re-parse the env and rebuild a client.
 *
 * When a simulation override is installed, every consumer (budget, approval
 * and conversation stores) resolves to that client instead.
 */
export function createRedis(): RedisClient {
  if (override) return override;
  return (cached ??= Redis.fromEnv() as unknown as RedisClient);
}

/**
 * Dev/simulator-only: route every `createRedis()` consumer at an injected
 * client — e.g. `createMemoryRedis()`. Gated on the same condition as the
 * simulator route mount (`isSimEnabled`) so it can't override Redis on a
 * non-production preview/staging deploy. Pass `null` to restore the env client.
 */
export function __setRedisForSimulation(client: RedisClient | null): void {
  if (process.env.NODE_ENV === "production" || process.env.SIMULATOR_ENABLED !== "1") return;
  override = client ?? undefined;
}

/** Reset the memoized client. Tests only — production paths must not call this. */
export function __resetRedisForTests(): void {
  cached = undefined;
  override = undefined;
}
