import { afterEach, expect, test } from "vitest";

import { getRedis, resetRedisForTest } from "./client.ts";

const config = { url: "https://example.upstash.io", token: "test-token" } as const;

afterEach(() => {
  resetRedisForTest();
});

test("getRedis is memoized so store construction does not rebuild the client", () => {
  const first = getRedis(config);
  const second = getRedis(config);

  expect(second).toBe(first);
});

test("the first caller's config wins", () => {
  const first = getRedis(config);
  const second = getRedis({ url: "https://other.upstash.io", token: "other" });

  expect(second).toBe(first);
});

test("resetRedisForTest drops the memoized client", () => {
  const first = getRedis(config);
  resetRedisForTest();

  expect(getRedis(config)).not.toBe(first);
});

test("the client exposes exactly the surface our stores depend on", () => {
  const redis = getRedis(config);

  // `eval` is the load-bearing one: releasing a lock only if we still hold it
  // cannot be expressed with plain commands.
  for (const method of [
    "get",
    "set",
    "del",
    "expire",
    "eval",
    "incrby",
    "sadd",
    "smembers",
    "srem",
    "pipeline",
  ] as const) {
    expect(typeof redis[method]).toBe("function");
  }
});
