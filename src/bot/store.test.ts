import { describe, it, expect, vi, beforeEach } from "vitest";

import { createMemoryRedis, memoryStore } from "@/lib/test/fixtures";

import type { ConversationStore } from "./store";

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => createMemoryRedis() },
}));

describe("ConversationStore", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = memoryStore();
  });

  describe("conversations", () => {
    const state = { workflowRunId: "run-1", channelId: "ch-1", startedAt: "2024-01-01" };

    it("sets and gets a conversation", async () => {
      await store.set(state);
      const result = await store.get("ch-1");
      expect(result?.workflowRunId).toBe("run-1");
    });

    it("uses threadId as key when present", async () => {
      await store.set({ ...state, threadId: "thread-1" });
      expect(await store.get("ch-1", "thread-1")).not.toBeNull();
      expect(await store.get("ch-1")).toBeNull();
    });

    it("deletes a conversation", async () => {
      await store.set(state);
      await store.delete("ch-1");
      expect(await store.get("ch-1")).toBeNull();
    });

    it("returns null for missing conversation", async () => {
      expect(await store.get("nonexistent")).toBeNull();
    });

    it("touch refreshes TTL without error", async () => {
      await store.set(state);
      await store.touch("ch-1");
      expect(await store.get("ch-1")).not.toBeNull();
    });
  });

  describe("dedup", () => {
    it("returns true for new keys", async () => {
      expect(await store.dedup("msg:1")).toBe(true);
    });

    it("returns false for duplicate keys", async () => {
      await store.dedup("msg:1");
      expect(await store.dedup("msg:1")).toBe(false);
    });
  });

  describe("locking", () => {
    it("acquires a lock and returns a token", async () => {
      const token = await store.acquireLock("ch-1");
      expect(token).toBeTypeOf("string");
      expect(token).toHaveLength(36);
    });

    it("returns null when lock is already held", async () => {
      await store.acquireLock("ch-1");
      expect(await store.acquireLock("ch-1")).toBeNull();
    });

    it("releases a lock with correct token", async () => {
      const token = await store.acquireLock("ch-1");
      await store.releaseLock("ch-1", token!);
      expect(await store.acquireLock("ch-1")).not.toBeNull();
    });

    it("does not release with wrong token", async () => {
      await store.acquireLock("ch-1");
      await store.releaseLock("ch-1", "wrong-token");
      expect(await store.acquireLock("ch-1")).toBeNull();
    });

    it("different channels have independent locks", async () => {
      await store.acquireLock("ch-1");
      expect(await store.acquireLock("ch-2")).not.toBeNull();
    });
  });

  describe("default constructor", () => {
    it("uses Redis.fromEnv when no redis argument is provided", async () => {
      const { ConversationStore } = await import("./store");
      const defaultStore = new ConversationStore();
      expect(await defaultStore.get("nonexistent")).toBeNull();
    });
  });
});
