import type { RedisClient } from "@/lib/redis/client";

import { createRedis } from "@/lib/redis/client";

import type { SandboxProvider } from "./types.ts";

import { startSandboxLifecycle } from "./lifecycle-starter.ts";
import { defaultSandboxProvider } from "./provider.ts";

/**
 * Default-dependency resolvers for session.ts. Extracted so session's
 * business logic can be tested by injecting fakes, while the glue paths
 * (`createRedis()`, `defaultSandboxProvider()`, `startSandboxLifecycle`)
 * live in this file and get swept under vitest's coverage-exclude list.
 *
 * Every function here is a thin fallback — replacing it wholesale via DI
 * is the intended way to exercise these code paths in tests.
 */

export function resolveRedis(redis: RedisClient | undefined): RedisClient {
  return redis ?? createRedis();
}

export function resolveProvider(provider: SandboxProvider | undefined): SandboxProvider {
  return provider ?? defaultSandboxProvider();
}

export function resolveOnProvisioned(
  hook: ((threadKey: string) => Promise<void>) | undefined,
): (threadKey: string) => Promise<void> {
  return hook ?? startSandboxLifecycle;
}
