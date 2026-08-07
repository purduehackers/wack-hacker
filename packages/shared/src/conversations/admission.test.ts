import { describe, expect, spyOn, test } from "bun:test";

import type { RedisClient } from "../redis/client.ts";
import type { DeliveryPayload } from "../wire.ts";
import { createConversationStore, DELIVERY_ADMISSION_TTL_MS } from "./index.ts";
import { activeKey, ingressKey } from "./keys.ts";

interface ActiveDelivery {
  phase: "claimed" | "live" | "recovery-required";
  dispatchId: string;
  messageId: string;
  sessionId: string;
  admissionAttemptId?: string;
}

interface AdmissionLease {
  readonly owner: string;
  readonly expiresAt: number;
}

function stringAt(argumentsList: (string | number)[], index: number): string {
  const candidate = argumentsList[index];
  if (typeof candidate !== "string") throw new Error(`argument ${index} was not a string`);
  return candidate;
}

function numberAt(argumentsList: (string | number)[], index: number): number {
  const candidate = argumentsList[index];
  if (typeof candidate !== "number") throw new Error(`argument ${index} was not a number`);
  return candidate;
}

function keyAt(scriptKeys: string[], index: number): string {
  const candidate = scriptKeys[index];
  if (candidate === undefined) throw new Error(`key ${index} was missing`);
  return candidate;
}

/** State-aware Redis stand-in for the three coordination Lua scripts. */
class AdmissionRedis {
  private readonly active = new Map<string, ActiveDelivery>();
  private readonly leases = new Map<string, AdmissionLease>();
  private currentTime = 0;

  setNow(now: number): void {
    this.currentTime = now;
  }

  seedClaimed(payload: DeliveryPayload): void {
    this.active.set(activeKey(payload.continuationKey), {
      phase: "claimed",
      dispatchId: payload.dispatchId,
      messageId: payload.messageId,
      sessionId: "",
    });
  }

  activeFor(payload: DeliveryPayload): ActiveDelivery | undefined {
    return this.active.get(activeKey(payload.continuationKey));
  }

  leaseFor(continuationKey: string): AdmissionLease | undefined {
    const key = ingressKey(continuationKey);
    const lease = this.leases.get(key);
    if (lease !== undefined && lease.expiresAt <= this.currentTime) {
      this.leases.delete(key);
      return undefined;
    }
    return lease;
  }

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (script.includes("wack:start-delivery")) {
      // The stand-in models Redis storage, while these guards bind it to the
      // load-bearing Lua predicates rather than merely recognizing a marker.
      if (
        !script.includes("active.admissionAttemptId == ARGV[3] and admissionOwner == ARGV[3]") ||
        !script.includes('active.phase = "recovery-required"')
      ) {
        throw new Error("start-delivery script omitted the live-admission recovery fence");
      }
      return this.start(keys, args);
    }
    if (script.includes("wack:confirm-delivery")) return this.confirm(keys, args);
    if (script.includes("wack:finish-admission")) return this.finish(keys, args);
    throw new Error("unexpected coordination script");
  }

  private start(keys: string[], args: (string | number)[]): string {
    const active = this.active.get(keyAt(keys, 0));
    if (active === undefined) return JSON.stringify({ status: "stale" });
    const dispatchId = stringAt(args, 0);
    const messageId = stringAt(args, 1);
    const attemptId = stringAt(args, 2);
    if (active.dispatchId !== dispatchId || active.messageId !== messageId) {
      return JSON.stringify({ status: "stale" });
    }
    if (active.phase === "claimed") {
      active.phase = "live";
      active.admissionAttemptId = attemptId;
      this.refreshLease(keyAt(keys, 2), attemptId, numberAt(args, 3));
      return JSON.stringify({ status: "start", admissionAttemptId: attemptId });
    }
    if (active.sessionId !== "") {
      return JSON.stringify({ status: "accepted", sessionId: active.sessionId });
    }
    if (active.phase === "live") {
      const lease = this.leaseFor(keyAt(keys, 2).slice("agent:ingress:".length));
      if (active.admissionAttemptId === attemptId && lease?.owner === attemptId) {
        this.refreshLease(keyAt(keys, 2), attemptId, numberAt(args, 3));
        return JSON.stringify({ status: "start", admissionAttemptId: attemptId });
      }
      if (lease === undefined) {
        active.phase = "recovery-required";
        return JSON.stringify({ status: "recovery-required" });
      }
    }
    return JSON.stringify({
      status: active.phase === "recovery-required" ? "recovery-required" : "in-progress",
    });
  }

  private confirm(keys: string[], args: (string | number)[]): number {
    const active = this.active.get(keyAt(keys, 0));
    if (active === undefined) return 0;
    if (active.dispatchId !== stringAt(args, 0) || active.messageId !== stringAt(args, 1)) return 0;
    if (active.phase !== "live") return 0;
    active.sessionId = stringAt(args, 2);
    return 1;
  }

  private finish(scriptKeys: string[], args: (string | number)[]): number {
    const ingressKey = keyAt(scriptKeys, 0);
    const lease = this.leaseFor(ingressKey.slice("agent:ingress:".length));
    if (lease?.owner !== stringAt(args, 0)) return 0;
    this.leases.delete(ingressKey);
    return 1;
  }

  private refreshLease(key: string, owner: string, ttlMs: number): void {
    this.leases.set(key, { owner, expiresAt: this.currentTime + ttlMs });
  }
}

function admission(redis: AdmissionRedis) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
  return createConversationStore({ redis: redis as unknown as RedisClient }).admission;
}

const ATTEMPT_ONE = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_TWO = "10000000-0000-4000-8000-000000000002";
const ATTEMPT_THREE = "10000000-0000-4000-8000-000000000003";

const delivery: DeliveryPayload = {
  kind: "mention",
  continuationKey: "30000000000000000",
  content: "hello",
  messageId: "40000000000000000",
  principal: {
    userId: "10000000000000000",
    username: "member",
    nickname: "Member",
    memberRoles: [],
  },
  channel: { id: "30000000000000000", name: "bot-test" },
  dispatchId: "00000000-0000-4000-8000-000000000000",
};

describe("live delivery admission", () => {
  test("recovers an automatic retry with the same attempt and refreshes its TTL", async () => {
    const redis = new AdmissionRedis();
    redis.setNow(1_000);
    redis.seedClaimed(delivery);

    expect(await admission(redis).start(delivery, ATTEMPT_ONE)).toEqual({
      status: "start",
      admissionAttemptId: ATTEMPT_ONE,
    });
    expect(redis.activeFor(delivery)).toMatchObject({
      phase: "live",
      admissionAttemptId: ATTEMPT_ONE,
    });
    expect(redis.leaseFor(delivery.continuationKey)).toEqual({
      owner: ATTEMPT_ONE,
      expiresAt: 1_000 + DELIVERY_ADMISSION_TTL_MS,
    });

    redis.setNow(6_000);
    expect(await admission(redis).start(delivery, ATTEMPT_ONE)).toEqual({
      status: "start",
      admissionAttemptId: ATTEMPT_ONE,
    });
    expect(redis.leaseFor(delivery.continuationKey)).toEqual({
      owner: ATTEMPT_ONE,
      expiresAt: 6_000 + DELIVERY_ADMISSION_TTL_MS,
    });
    expect(await admission(redis).start(delivery, ATTEMPT_TWO)).toEqual({
      status: "in-progress",
    });
  });

  test("terminates an expired live admission without replaying ambiguous Eve work", async () => {
    const redis = new AdmissionRedis();
    redis.setNow(1_000);
    redis.seedClaimed(delivery);
    await admission(redis).start(delivery, ATTEMPT_ONE);
    redis.setNow(1_000 + DELIVERY_ADMISSION_TTL_MS);
    const logged = spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await admission(redis).start(delivery, ATTEMPT_TWO)).toEqual({
        status: "recovery-required",
      });
      expect(redis.activeFor(delivery)?.phase).toBe("recovery-required");
      expect(await admission(redis).confirm(delivery, "late-session")).toBe(false);
      expect(await admission(redis).start(delivery, ATTEMPT_ONE)).toEqual({
        status: "recovery-required",
      });
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({
          event: "discord.delivery.recovery_required",
          continuationKey: delivery.continuationKey,
          dispatchId: delivery.dispatchId,
          messageId: delivery.messageId,
          remediation: "reset-conversation-before-retrying",
        }),
      );
    } finally {
      logged.mockRestore();
    }
  });

  test("returns the accepted session when the first HTTP response was lost", async () => {
    const redis = new AdmissionRedis();
    redis.seedClaimed(delivery);
    await admission(redis).start(delivery, ATTEMPT_ONE);

    expect(await admission(redis).confirm(delivery, "session-1")).toBe(true);
    expect(await admission(redis).start(delivery, ATTEMPT_TWO)).toEqual({
      status: "accepted",
      sessionId: "session-1",
    });
  });

  test("expires the reset-visible lease and only lets its owner finish early", async () => {
    const redis = new AdmissionRedis();
    redis.setNow(10);
    redis.seedClaimed(delivery);
    await admission(redis).start(delivery, ATTEMPT_ONE);

    expect(await admission(redis).finish(delivery.continuationKey, ATTEMPT_TWO)).toBe(false);
    expect(redis.leaseFor(delivery.continuationKey)?.owner).toBe(ATTEMPT_ONE);
    expect(await admission(redis).finish(delivery.continuationKey, ATTEMPT_ONE)).toBe(true);
    expect(redis.leaseFor(delivery.continuationKey)).toBeUndefined();

    const expiring = new AdmissionRedis();
    expiring.setNow(10);
    expiring.seedClaimed(delivery);
    await admission(expiring).start(delivery, ATTEMPT_THREE);
    expiring.setNow(10 + DELIVERY_ADMISSION_TTL_MS);
    expect(expiring.leaseFor(delivery.continuationKey)).toBeUndefined();
    expect(await admission(expiring).finish(delivery.continuationKey, ATTEMPT_THREE)).toBe(false);
  });
});
