import { describe, it, expect, vi } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures";

import type { TurnMessageRecord } from "./turn-message-store";

import { TurnMessageStore } from "./turn-message-store";

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => createMemoryRedis() },
}));

const sampleRecord: TurnMessageRecord = {
  chatId: "wf-run-1",
  traceId: "0af7651916cd43dd8448eb211c80319c",
  domains: ["linear", "notion"],
  channelId: "ch-1",
  userId: "user-1",
};

describe("TurnMessageStore", () => {
  it("sets and gets a record keyed by discord message id", async () => {
    const store = new TurnMessageStore(createMemoryRedis());
    await store.set("msg-1", sampleRecord);
    expect(await store.get("msg-1")).toEqual(sampleRecord);
  });

  it("keys records independently per message id", async () => {
    const store = new TurnMessageStore(createMemoryRedis());
    await store.set("msg-1", sampleRecord);
    expect(await store.get("msg-2")).toBeNull();
  });

  it("returns null for a missing record", async () => {
    const store = new TurnMessageStore(createMemoryRedis());
    expect(await store.get("nope")).toBeNull();
  });

  it("expires records after the 7-day TTL", async () => {
    vi.useFakeTimers();
    try {
      const store = new TurnMessageStore(createMemoryRedis());
      await store.set("msg-1", sampleRecord);
      vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1);
      expect(await store.get("msg-1")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps records alive within the TTL window", async () => {
    vi.useFakeTimers();
    try {
      const store = new TurnMessageStore(createMemoryRedis());
      await store.set("msg-1", sampleRecord);
      vi.advanceTimersByTime(6 * 24 * 60 * 60 * 1000);
      expect(await store.get("msg-1")).toEqual(sampleRecord);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses Redis.fromEnv when no redis argument is provided", async () => {
    const store = new TurnMessageStore();
    expect(await store.get("nonexistent")).toBeNull();
  });
});
