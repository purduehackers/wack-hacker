import type { MessageMetadata } from "@vercel/queue";

import { describe, expect, it, vi } from "vitest";

import type { HandlerContext } from "@/bot/types";
import type { Packet } from "@/lib/protocol/types";

import { memoryStore, messagePacket, reactionPacket } from "@/lib/test/fixtures";

import { LockContentionError } from "./errors";
import { eventRetryPolicy, processEvent } from "./process-event";

function queueMetadata(deliveryCount: number): MessageMetadata {
  return {
    messageId: "qmsg-1",
    deliveryCount,
    createdAt: new Date("2024-01-01"),
    expiresAt: new Date("2024-01-02"),
    topicName: "discord-events",
    consumerGroup: "default",
    region: "iad1",
  };
}

describe("processEvent", () => {
  it("dispatches a fresh event with the injected store in ctx", async () => {
    const store = memoryStore();
    const dispatch = vi.fn(async (_p: Packet, _c: HandlerContext) => {});
    const packet = messagePacket("hello");

    await processEvent(packet, store, dispatch);

    expect(dispatch).toHaveBeenCalledOnce();
    const [dispatched, ctx] = dispatch.mock.calls[0]!;
    expect(dispatched).toBe(packet);
    expect(ctx.store).toBe(store);
  });

  it("short-circuits a true duplicate without re-dispatching", async () => {
    const store = memoryStore();
    const dispatch = vi.fn(async () => {});

    await processEvent(messagePacket("hello"), store, dispatch);
    await processEvent(messagePacket("hello"), store, dispatch);

    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("releases the dedup claim when dispatch throws so a retry re-executes", async () => {
    const store = memoryStore();
    const dispatch = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error("discord 5xx"))
      .mockResolvedValueOnce(undefined);

    await expect(processEvent(messagePacket("hello"), store, dispatch)).rejects.toThrow(
      "discord 5xx",
    );
    // Second delivery of the same packet must re-run, not hit the dedup claim.
    await processEvent(messagePacket("hello"), store, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("releases the channel lock after a failed dispatch", async () => {
    const store = memoryStore();
    const dispatch = vi.fn(async () => {}).mockRejectedValueOnce(new Error("boom"));

    await expect(processEvent(messagePacket("hello"), store, dispatch)).rejects.toThrow("boom");

    expect(await store.acquireLock("ch-1")).not.toBeNull();
  });

  it("throws LockContentionError and releases dedup when the channel lock is held", async () => {
    const store = memoryStore();
    const dispatch = vi.fn(async () => {});
    const token = await store.acquireLock("ch-1");

    await expect(processEvent(messagePacket("hello"), store, dispatch)).rejects.toBeInstanceOf(
      LockContentionError,
    );
    expect(dispatch).not.toHaveBeenCalled();

    // Once the holder releases, the redelivered packet must process — the
    // contention path released its dedup claim.
    await store.releaseLock("ch-1", token!);
    await processEvent(messagePacket("hello"), store, dispatch);

    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("does not take the channel lock for non-message packets", async () => {
    const store = memoryStore();
    const dispatch = vi.fn(async () => {});
    await store.acquireLock("ch-1");

    await processEvent(reactionPacket("✨"), store, dispatch);

    expect(dispatch).toHaveBeenCalledOnce();
  });
});

describe("eventRetryPolicy", () => {
  it("retries lock contention on a short fixed delay", () => {
    const directive = eventRetryPolicy(new LockContentionError("ch-1"), queueMetadata(1));
    expect(directive).toEqual({ afterSeconds: 3 });
  });

  it("gives lock contention a larger budget than generic errors", () => {
    expect(eventRetryPolicy(new LockContentionError("ch-1"), queueMetadata(9))).toEqual({
      afterSeconds: 3,
    });
    expect(eventRetryPolicy(new Error("boom"), queueMetadata(9))).toEqual({ acknowledge: true });
  });

  it("acknowledges lock contention once its redelivery budget is spent", () => {
    expect(eventRetryPolicy(new LockContentionError("ch-1"), queueMetadata(10))).toEqual({
      acknowledge: true,
    });
  });

  it("keeps exponential backoff for generic errors", () => {
    expect(eventRetryPolicy(new Error("boom"), queueMetadata(1))).toEqual({ afterSeconds: 10 });
    expect(eventRetryPolicy(new Error("boom"), queueMetadata(2))).toEqual({ afterSeconds: 20 });
  });

  it("acknowledges generic errors after MAX_RETRIES deliveries", () => {
    expect(eventRetryPolicy(new Error("boom"), queueMetadata(3))).toEqual({ acknowledge: true });
  });
});
