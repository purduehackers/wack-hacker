import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetRedisForTests, createRedis } from "./client";

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
