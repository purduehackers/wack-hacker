import { describe, expect, test } from "bun:test";

import { Result } from "@repo/shared/result";
import {
  AGENT_RENDER_READY_SET_KEY,
  agentActiveKey,
  agentIngressKey,
  agentResetKey,
} from "@repo/shared/wire";
import type { DeliveryPayload, RenderIntent } from "@repo/shared/wire";

import {
  ADMISSION_RECOVERY_FOOTER,
  ADMISSION_RECOVERY_TEXT,
  recoverAdmission,
  type QueueRecoveryStore,
} from "./queue.ts";

interface ActiveDelivery {
  phase: "live" | "recovery-required";
  readonly dispatchId: string;
  readonly messageId: string;
  readonly sessionId: string;
  readonly deliveryRaw: string;
  recoveryReported?: boolean;
}

class RecoveryRedis implements QueueRecoveryStore {
  active: ActiveDelivery | undefined;
  reset = false;
  ingress = false;
  intent: RenderIntent | undefined;
  readonly ready = new Set<string>();

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (!script.includes("wack:recover-admission")) throw new Error("unexpected script");
    if (
      !script.includes('active.phase = "recovery-required"') ||
      !script.includes('redis.call("SET", intentKey, cjson.encode(intent))')
    ) {
      throw new Error("recovery script omitted its atomic terminal transition or render");
    }
    expect(keys).toEqual([
      agentActiveKey(delivery.continuationKey),
      agentResetKey(delivery.continuationKey),
      agentIngressKey(delivery.continuationKey),
      AGENT_RENDER_READY_SET_KEY,
    ]);
    if (this.reset || this.active === undefined) return undefined;
    if (this.active.phase === "live" && this.active.sessionId === "" && !this.ingress) {
      this.active.phase = "recovery-required";
    }
    if (this.active.phase !== "recovery-required") return undefined;

    const recoveryTurnId = String(args[0]);
    if (this.intent?.phase !== "failed" || this.intent.eveTurnId !== recoveryTurnId) {
      this.intent = {
        dispatchId: this.active.dispatchId,
        continuationKey: delivery.continuationKey,
        messageId: this.active.messageId,
        sessionId: "recovery-required",
        eveTurnId: recoveryTurnId,
        revision: (this.intent?.revision ?? 0) + 1,
        phase: "failed",
        text: String(args[1]),
        activity: "",
        footer: String(args[2]),
      };
      this.ready.add(`r:${this.active.dispatchId}`);
    }
    const shouldReport = !this.active.recoveryReported;
    this.active.recoveryReported = true;
    return shouldReport ? this.active.deliveryRaw : undefined;
  }
}

const delivery: DeliveryPayload = {
  kind: "followup",
  continuationKey: "30000000000000000",
  content: "ambiguous turn",
  messageId: "40000000000000000",
  principal: {
    userId: "10000000000000000",
    username: "requester",
    nickname: "Requester",
    memberRoles: [],
  },
  channel: { id: "30000000000000000", name: "agent-thread" },
  dispatchId: "00000000-0000-4000-8000-000000000001",
};

function seed(redis: RecoveryRedis): void {
  redis.active = {
    phase: "live",
    dispatchId: delivery.dispatchId,
    messageId: delivery.messageId,
    sessionId: "",
    deliveryRaw: JSON.stringify(delivery),
  };
}

describe("bot admission recovery sweep", () => {
  test("atomically terminates an expired live admission and publishes one visible render", async () => {
    const redis = new RecoveryRedis();
    seed(redis);

    const recovered = await recoverAdmission(redis, delivery.continuationKey);
    expect(Result.isOk(recovered) ? recovered.value : undefined).toEqual(delivery);
    expect(redis.active?.phase).toBe("recovery-required");
    expect(redis.intent).toMatchObject({
      dispatchId: delivery.dispatchId,
      phase: "failed",
      text: ADMISSION_RECOVERY_TEXT,
      footer: ADMISSION_RECOVERY_FOOTER,
    });
    expect(redis.ready).toEqual(new Set([`r:${delivery.dispatchId}`]));

    const repeated = await recoverAdmission(redis, delivery.continuationKey);
    expect(Result.isOk(repeated) ? repeated.value : delivery).toBeUndefined();
    expect(redis.intent?.revision).toBe(1);
  });

  test("does not recover while the admission lease or manual reset barrier exists", async () => {
    const redis = new RecoveryRedis();
    seed(redis);
    redis.ingress = true;
    expect(await recoverAdmission(redis, delivery.continuationKey)).toMatchObject({
      status: "ok",
      value: undefined,
    });
    expect(redis.active?.phase).toBe("live");

    redis.ingress = false;
    redis.reset = true;
    expect(await recoverAdmission(redis, delivery.continuationKey)).toMatchObject({
      status: "ok",
      value: undefined,
    });
    expect(redis.active?.phase).toBe("live");
    expect(redis.intent).toBeUndefined();
  });
});
