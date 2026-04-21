import { describe, expect, it, vi } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures";

import type { ApprovalState } from "./types.ts";

import { ApprovalStore } from "./store.ts";

function baseState(overrides: Partial<ApprovalState> = {}): ApprovalState {
  return {
    id: "a1",
    status: "pending",
    toolName: "doit",
    input: { foo: "bar" },
    reason: "because",
    channelId: "ch-1",
    requesterUserId: "user-1",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ApprovalStore CRUD", () => {
  it("create + get round-trips state", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    const got = await store.get("a1");
    expect(got?.toolName).toBe("doit");
    expect(got?.status).toBe("pending");
  });

  it("get returns null for missing ids", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    expect(await store.get("nope")).toBeNull();
  });

  it("setMessageId updates only the messageId", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    await store.setMessageId("a1", "msg-9");
    const got = await store.get("a1");
    expect(got?.messageId).toBe("msg-9");
    expect(got?.toolName).toBe("doit");
  });

  it("setMessageId is a no-op when the row is missing", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.setMessageId("gone", "msg-9");
    expect(await store.get("gone")).toBeNull();
  });
});

describe("ApprovalStore.decide", () => {
  it("flips pending → approved and records decidedByUserId", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    const out = await store.decide("a1", "approved", "user-1");
    expect(out?.status).toBe("approved");
    expect(out?.decidedByUserId).toBe("user-1");
    expect(out?.decidedAt).toBeTruthy();
  });

  it("returns null when the row doesn't exist", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    expect(await store.decide("gone", "approved", "user-1")).toBeNull();
  });

  it("is idempotent — calling twice returns the first decision", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    await store.decide("a1", "approved", "user-1");
    const second = await store.decide("a1", "denied", "user-2");
    expect(second?.status).toBe("approved");
    expect(second?.decidedByUserId).toBe("user-1");
  });
});

describe("ApprovalStore.waitFor", () => {
  it("returns once the status flips", async () => {
    vi.useFakeTimers();
    try {
      const store = new ApprovalStore(createMemoryRedis());
      await store.create(baseState());
      const pending = store.waitFor("a1", { intervalMs: 10, timeoutMs: 10_000 });
      await vi.advanceTimersByTimeAsync(10);
      await store.decide("a1", "approved", "user-1");
      await vi.advanceTimersByTimeAsync(20);
      const out = await pending;
      expect(out.status).toBe("approved");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns timeout and flips the row when the deadline passes", async () => {
    vi.useFakeTimers();
    try {
      const store = new ApprovalStore(createMemoryRedis());
      await store.create(baseState());
      const pending = store.waitFor("a1", { intervalMs: 10, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(200);
      const out = await pending;
      expect(out.status).toBe("timeout");
      const row = await store.get("a1");
      expect(row?.status).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns synthetic timeout if the row vanished mid-wait (TTL)", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    // Don't create any row at all.
    const out = await store.waitFor("missing", { intervalMs: 10, timeoutMs: 50 });
    expect(out.status).toBe("timeout");
  });

  it("rejects when the abort signal fires", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    const controller = new AbortController();
    const pending = store.waitFor("a1", {
      intervalMs: 20,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
