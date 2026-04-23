import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryRedis } from "./fakes";

describe("createMemoryRedis", () => {
  let redis: ReturnType<typeof createMemoryRedis>;

  beforeEach(() => {
    redis = createMemoryRedis();
  });

  describe("kv ops", () => {
    it("get/set round-trips", async () => {
      await redis.set("k", { a: 1 });
      expect(await redis.get("k")).toEqual({ a: 1 });
    });

    it("nx respects existing key", async () => {
      await redis.set("k", "a");
      const result = await redis.set("k", "b", { nx: true });
      expect(result).toBeNull();
      expect(await redis.get("k")).toBe("a");
    });

    it("px expires after the given window", async () => {
      await redis.set("k", "v", { px: 1 });
      await new Promise((r) => setTimeout(r, 5));
      expect(await redis.get("k")).toBeNull();
    });

    it("del returns 1 for hit, 0 for miss", async () => {
      await redis.set("k", "v");
      expect(await redis.del("k")).toBe(1);
      expect(await redis.del("k")).toBe(0);
    });

    it("expire extends TTL", async () => {
      await redis.set("k", "v");
      const result = await redis.expire("k", 60);
      expect(result).toBe(1);
      expect(await redis.expire("missing", 60)).toBe(0);
    });
  });

  describe("eval (lock-release lua)", () => {
    it("deletes when token matches", async () => {
      await redis.set("lock:x", "tok");
      expect(await redis.eval("release-lock", ["lock:x"], ["tok"])).toBe(1);
      expect(await redis.get("lock:x")).toBeNull();
    });

    it("returns 0 when token mismatches", async () => {
      await redis.set("lock:x", "tok");
      expect(await redis.eval("release-lock", ["lock:x"], ["other"])).toBe(0);
      expect(await redis.get("lock:x")).toBe("tok");
    });
  });

  describe("set ops", () => {
    it("sadd counts only newly added members", async () => {
      expect(await redis.sadd("s", "a", "b")).toBe(2);
      expect(await redis.sadd("s", "b", "c")).toBe(1);
    });

    it("smembers returns current members as array", async () => {
      await redis.sadd("s", "a", "b");
      const members = (await redis.smembers<string[]>("s")).sort();
      expect(members).toEqual(["a", "b"]);
    });

    it("srem returns count removed", async () => {
      await redis.sadd("s", "a", "b");
      expect(await redis.srem("s", "a", "missing")).toBe(1);
    });
  });

  describe("pipeline", () => {
    it("batches gets and returns results in order", async () => {
      await redis.set("a", 1);
      await redis.set("b", 2);
      const pipeline = redis.pipeline();
      pipeline.get("a").get("b").get("missing");
      const result = await pipeline.exec<(number | null)[]>();
      expect(result).toEqual([1, 2, null]);
    });
  });

  describe("reset", () => {
    it("wipes kv and set state", async () => {
      await redis.set("a", 1);
      await redis.sadd("s", "x");
      redis.reset();
      expect(await redis.get("a")).toBeNull();
      expect(await redis.smembers<string[]>("s")).toEqual([]);
    });
  });
});
