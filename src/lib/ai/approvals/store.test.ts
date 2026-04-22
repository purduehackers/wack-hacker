import { describe, expect, it, vi } from "vitest";

import { baseApprovalState as baseState, createMemoryRedis } from "@/lib/test/fixtures";

import { ApprovalStore } from "./store.ts";

describe("ApprovalStore CRUD", () => {
  it("create + get round-trips state", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    const got = await store.get("a1");
    expect(got?.toolName).toBe("doit");
    expect(got?.status).toBe("pending");
  });

  it("create passes a ttlSeconds override through to Redis", async () => {
    const redis = createMemoryRedis();
    const setSpy = vi.spyOn(redis, "set");
    const store = new ApprovalStore(redis);
    await store.create(baseState(), 999);
    const [, , opts] = setSpy.mock.calls[0]!;
    expect((opts as { ex?: number }).ex).toBe(999);
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

  it("serializes concurrent decides — exactly one wins, both see the winner", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    const [a, b] = await Promise.all([
      store.decide("a1", "approved", "user-1"),
      store.decide("a1", "timeout", null),
    ]);
    expect(a?.status).toBe(b?.status);
    expect(["approved", "timeout"]).toContain(a?.status);
    const persisted = await store.get("a1");
    expect(persisted?.status).toBe(a?.status);
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

  it("rejects when the abort signal fires before the first sleep starts", async () => {
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

  it("rejects when the abort signal fires while a sleep is already waiting", async () => {
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    const controller = new AbortController();
    const pending = store.waitFor("a1", {
      intervalMs: 60_000,
      timeoutMs: 120_000,
      signal: controller.signal,
    });
    // Let the first iteration reach `sleep()` before aborting so the listener
    // path (not the synchronous pre-check) is exercised.
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });

  it("is a no-op when a pre-aborted signal is supplied to sleep via the inner branch", async () => {
    // Pre-aborted signal: waitFor's outer check throws first, so sleep is not reached.
    const store = new ApprovalStore(createMemoryRedis());
    await store.create(baseState());
    const controller = new AbortController();
    controller.abort();
    await expect(
      store.waitFor("a1", {
        intervalMs: 10,
        timeoutMs: 10_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });
});
