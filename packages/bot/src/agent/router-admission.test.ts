import { describe, expect, test } from "bun:test";

import { UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { WideEvent } from "@repo/shared/result/observe";
import type { DeliveryPayload, InteractionPayload, ResetRequestPayload } from "@repo/shared/wire";

import { createAgentRouter } from "./router.ts";

const delivery: DeliveryPayload = {
  kind: "followup",
  continuationKey: "30000000000000000",
  content: "retry",
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

describe("agent router admission remediation", () => {
  test("surfaces a terminal admission error to the message handler and logs it", async () => {
    const reportedEvents: WideEvent[] = [];
    const recovery = new UpstreamError({
      service: "agent",
      status: 409,
      detail: "RecoveryRequired: reset this conversation before retrying",
    });
    let claimed = false;
    const router = createAgentRouter({
      client: {
        sendMessage: async (_delivery: DeliveryPayload) => Result.err(recovery),
        sendInteraction: async (_interaction: InteractionPayload) =>
          Result.ok({ sessionId: "session-1", continuationToken: delivery.continuationKey }),
        sendReset: async (_reset: ResetRequestPayload) => Result.ok(undefined),
      },
      queue: {
        enqueue: async () => {},
        claim: async () => {
          if (claimed) return Result.ok(undefined);
          claimed = true;
          return Result.ok({ payload: delivery, claimToken: "claim-1" });
        },
        recoverAdmission: async () => Result.ok(undefined),
        confirm: async () => true,
        complete: async () => "missing",
        keys: async () => [],
        readyKeys: async () => [],
        parked: async () => Result.ok(undefined),
        depth: async () => 0,
        beginReset: async () => "00000000-0000-4000-8000-000000000099",
        commitReset: async () => true,
        purge: async () => {},
      },
      reporter: {
        emit: (wideEvent) => reportedEvents.push(wideEvent),
        captureDefect: () => {},
      },
      recoveryIntervalMs: 0,
    });

    const submitted = await router.submit(delivery);
    expect(submitted).toEqual(Result.err(recovery));
    expect(reportedEvents).toContainEqual({
      op: "agent.router.send",
      status: "error",
      errorTag: "UpstreamError",
      errorMessage: recovery.message,
      attributes: {
        continuationKey: delivery.continuationKey,
        messageId: delivery.messageId,
        dispatchId: delivery.dispatchId,
      },
    });
    router.stop();
  });
});

describe("agent router admission sweep", () => {
  test("checks every active queue for an expired admission without retrying sendMessage", async () => {
    const recorded: WideEvent[] = [];
    let recoveryChecks = 0;
    let sends = 0;
    const router = createAgentRouter({
      client: {
        sendMessage: async (_delivery: DeliveryPayload) => {
          sends += 1;
          return Result.ok({
            sessionId: "unexpected",
            continuationToken: delivery.continuationKey,
          });
        },
        sendInteraction: async (_interaction: InteractionPayload) =>
          Result.ok({ sessionId: "session-1", continuationToken: delivery.continuationKey }),
        sendReset: async (_reset: ResetRequestPayload) => Result.ok(undefined),
      },
      queue: {
        enqueue: async () => {},
        claim: async () => Result.ok(undefined),
        recoverAdmission: async () => {
          recoveryChecks += 1;
          return Result.ok(delivery);
        },
        confirm: async () => true,
        complete: async () => "missing",
        keys: async () => [delivery.continuationKey],
        readyKeys: async () => [],
        parked: async () => Result.ok(undefined),
        depth: async () => 0,
        beginReset: async () => "00000000-0000-4000-8000-000000000099",
        commitReset: async () => true,
        purge: async () => {},
      },
      reporter: {
        emit: (wideEvent) => recorded.push(wideEvent),
        captureDefect: () => {},
      },
      recoveryIntervalMs: 0,
    });

    await router.sweep();
    expect(recoveryChecks).toBe(1);
    expect(sends).toBe(0);
    expect(recorded).toContainEqual({
      op: "agent.router.recover-admission",
      status: "error",
      errorTag: "RecoveryRequired",
      errorMessage:
        "agent delivery admission requires recovery: the admission lease expired before Eve acknowledgement was durable; reset the conversation before retrying",
      attributes: {
        continuationKey: delivery.continuationKey,
        messageId: delivery.messageId,
        dispatchId: delivery.dispatchId,
      },
    });
    router.stop();
  });
});
