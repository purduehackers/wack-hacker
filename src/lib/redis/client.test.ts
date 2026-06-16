import { afterEach, describe, expect, it, vi } from "vitest";

import type { RedisClient } from "./types";

import { __resetRedisForTests, __setRedisForSimulation, createRedis } from "./client";

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn(() => ({ tag: "fromEnv" })) },
}));

describe("createRedis", () => {
  afterEach(() => __resetRedisForTests());

  it("returns a cached client across calls", async () => {
    const first = createRedis();
    const second = createRedis();
    expect(first).toBe(second);
  });

  it("rebuilds the client after __resetRedisForTests", () => {
    const before = createRedis();
    __resetRedisForTests();
    const after = createRedis();
    // Different object identity since the mock returns a fresh object each call.
    expect(after).not.toBe(before);
  });
});

describe("__setRedisForSimulation", () => {
  const prevFlag = process.env.SIMULATOR_ENABLED;
  afterEach(() => {
    __resetRedisForTests();
    if (prevFlag === undefined) delete process.env.SIMULATOR_ENABLED;
    else process.env.SIMULATOR_ENABLED = prevFlag;
  });

  it("overrides createRedis only when the simulator is enabled", () => {
    const sim = { tag: "sim" } as unknown as RedisClient;
    process.env.SIMULATOR_ENABLED = "1";
    __setRedisForSimulation(sim);
    expect(createRedis()).toBe(sim);

    // Gated off (the route never mounts here) → the swap no-ops, so the prior
    // override stays in place rather than the env-backed client taking over.
    delete process.env.SIMULATOR_ENABLED;
    __setRedisForSimulation({ tag: "ignored" } as unknown as RedisClient);
    expect(createRedis()).toBe(sim);
  });
});
