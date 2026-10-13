import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { closeRedis, getRedis, type RedisClient } from "./client.ts";

const url = process.env["REDIS_TEST_URL"];

describe.skipIf(url === undefined)("native Redis compatibility", () => {
  const prefix = `migration-test:wack:${crypto.randomUUID()}`;
  const keys = ["record", "lock", "counter", "members", "queue"].map(
    (suffix) => `${prefix}:${suffix}`,
  );
  let redis: RedisClient;

  beforeAll(() => {
    if (url === undefined) throw new Error("REDIS_TEST_URL is required");
    redis = getRedis({ url });
  });

  afterAll(async () => {
    try {
      await redis.del(...keys);
    } finally {
      await closeRedis();
    }
  });

  test("concurrent cold-start lock claims have exactly one winner", async () => {
    const claims = await Promise.all(
      Array.from({ length: 20 }, () =>
        redis.set(`${prefix}:lock`, "owner", { nx: true, px: 60_000 }),
      ),
    );
    expect(claims.filter((result) => result === "OK")).toHaveLength(1);
    expect(await redis.pttl(`${prefix}:lock`)).toBeGreaterThan(0);
  });

  test("objects and pre-encoded legacy records retain their JSON wire format and TTL", async () => {
    const value = { id: "99999999999999999", enabled: true, nested: ["one", 2] };
    const key = `${prefix}:record`;
    await redis.set(key, value, { ex: 60 });
    expect(await redis.get(key)).toEqual(value);
    await redis.set(key, JSON.stringify(value), { keepTtl: true });
    expect(await redis.get(key)).toEqual(value);
    expect(await redis.pttl(key)).toBeGreaterThan(0);
    await redis.set(key, "99999999999999999", { keepTtl: true });
    expect(await redis.get(key)).toBe("99999999999999999");
    await redis.set(key, "hack-night-80", { keepTtl: true });
    expect(await redis.get(key)).toBe("hack-night-80");
  });

  test("Lua fences ownership, decodes JSON, and supports durable queues", async () => {
    const script =
      "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end return redis.call('DEL', KEYS[1])";
    expect(await redis.eval(script, [`${prefix}:lock`], ["other"])).toBe(0);
    expect(await redis.eval(script, [`${prefix}:lock`], ["owner"])).toBe(1);
    const payload = JSON.stringify({ dispatchId: "test-dispatch" });
    await redis.eval(
      "redis.call('RPUSH', KEYS[1], ARGV[1]); redis.call('EXPIRE', KEYS[1], 60); return 1",
      [`${prefix}:queue`],
      [payload],
    );
    expect(await redis.llen(`${prefix}:queue`)).toBe(1);
    expect(await redis.eval("return redis.call('LPOP', KEYS[1])", [`${prefix}:queue`], [])).toEqual(
      {
        dispatchId: "test-dispatch",
      },
    );
  });

  test("counters and set membership keep numeric results and exact snowflakes", async () => {
    expect(await redis.incrby(`${prefix}:counter`, 2)).toBe(2);
    await redis.expire(`${prefix}:counter`, 60);
    await redis.sadd(`${prefix}:members`, "99999999999999999");
    await redis.expire(`${prefix}:members`, 60);
    expect(await redis.smembers(`${prefix}:members`)).toEqual(["99999999999999999"]);
    expect(await redis.sismember(`${prefix}:members`, "99999999999999999")).toBe(1);
    expect(await redis.srem(`${prefix}:members`, "99999999999999999")).toBe(1);
    expect(await redis.scard(`${prefix}:members`)).toBe(0);
    expect(await redis.get(`${prefix}:missing`)).toBeNull();
  });
});
