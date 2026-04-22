import { describe, expect, it } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures";

import { HackNightThreadStore, generateEventSlug, resolveEventSlug } from "./index.ts";

describe("generateEventSlug", () => {
  it("formats as hack-night-YYYY-MM-DD with zero-padded month and day", () => {
    expect(generateEventSlug(new Date(2026, 3, 5))).toBe("hack-night-2026-04-05");
  });
});

describe("HackNightThreadStore", () => {
  it("stores and retrieves a slug by thread id", async () => {
    const store = new HackNightThreadStore(createMemoryRedis());
    await store.set("t1", "hack-night-2026-04-24");
    expect(await store.get("t1")).toBe("hack-night-2026-04-24");
  });

  it("returns null for an unknown thread id", async () => {
    const store = new HackNightThreadStore(createMemoryRedis());
    expect(await store.get("missing")).toBeNull();
  });

  it("namespaces keys under hack-night-thread:", async () => {
    const redis = createMemoryRedis();
    const store = new HackNightThreadStore(redis);
    await store.set("t1", "hack-night-2026-04-24");
    expect(await redis.get("hack-night-thread:t1")).toBe("hack-night-2026-04-24");
  });
});

describe("resolveEventSlug", () => {
  it("returns the stored slug when present", async () => {
    const store = new HackNightThreadStore(createMemoryRedis());
    await store.set("t1", "hack-night-2026-04-24");
    const slug = await resolveEventSlug("t1", new Date(2026, 5, 1), store);
    expect(slug).toBe("hack-night-2026-04-24");
  });

  it("falls back to generateEventSlug of the provided date when nothing stored", async () => {
    const store = new HackNightThreadStore(createMemoryRedis());
    const slug = await resolveEventSlug("t-missing", new Date(2026, 3, 24), store);
    expect(slug).toBe("hack-night-2026-04-24");
  });
});
