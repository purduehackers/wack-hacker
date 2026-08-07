import { describe, expect, test } from "bun:test";

import type { ConversationStore } from "@repo/shared/conversations";
import { UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter, WideEvent } from "@repo/shared/result/observe";
import type { DeliveryPayload, InteractionPayload, ResetRequestPayload } from "@repo/shared/wire";

import type { AgentClient } from "../agent/client.ts";
import { createConversationFlow } from "./flow.ts";

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

function flowHarness(eve: AgentClient, queue: ConversationStore["queue"], reporter: Reporter) {
  return createConversationFlow({
    eve,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
    store: {
      queue,
      render: { ready: async () => [], outcome: async () => undefined },
    } as unknown as ConversationStore,
    rest: {
      postMessage: async () => Result.ok({ id: "50000000000000000", content: "" }),
      editMessage: async () => Result.ok(undefined),
      deleteMessage: async () => Result.ok(undefined),
      reply: async () => Result.ok({ id: "50000000000000000", content: "" }),
    },
    turnMessages: { record: async () => Result.ok(undefined) },
    schedules: { admit: async () => {} },
    reporter,
    recoveryIntervalMs: 0,
  });
}

describe("agent router admission remediation", () => {
  test("surfaces a terminal admission error to the message handler and logs it", async () => {
    const reportedEvents: WideEvent[] = [];
    const recovery = new UpstreamError({
      service: "agent",
      status: 409,
      detail: "RecoveryRequired: reset this conversation before retrying",
    });
    let claimed = false;
    const router = flowHarness(
      {
        sendMessage: async (_delivery: DeliveryPayload) => Result.err(recovery),
        sendInteraction: async (_interaction: InteractionPayload) =>
          Result.ok({ sessionId: "session-1", continuationToken: delivery.continuationKey }),
        sendReset: async (_reset: ResetRequestPayload) => Result.ok(undefined),
      },
      {
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
      {
        emit: (wideEvent) => reportedEvents.push(wideEvent),
        captureDefect: () => {},
      },
    );

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
    await router.stop();
  });
});

describe("agent router admission sweep", () => {
  test("checks every active queue for an expired admission without retrying sendMessage", async () => {
    const recorded: WideEvent[] = [];
    let recoveryChecks = 0;
    let sends = 0;
    const router = flowHarness(
      {
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
      {
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
      {
        emit: (wideEvent) => recorded.push(wideEvent),
        captureDefect: () => {},
      },
    );

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
    await router.stop();
  });
});

test("a throwing recovery entry does not starve later continuation keys", async () => {
  const poisonedKey = "30000000000000001";
  const recoveredKeys: string[] = [];
  const claimedKeys: string[] = [];
  const defects: string[] = [];
  const flow = flowHarness(
    {
      sendMessage: async (_delivery: DeliveryPayload) =>
        Result.ok({ sessionId: "session-1", continuationToken: delivery.continuationKey }),
      sendInteraction: async (_interaction: InteractionPayload) =>
        Result.ok({ sessionId: "session-1", continuationToken: delivery.continuationKey }),
      sendReset: async (_reset: ResetRequestPayload) => Result.ok(undefined),
    },
    {
      enqueue: async () => {},
      claim: async (continuationKey) => {
        claimedKeys.push(continuationKey);
        return Result.ok(undefined);
      },
      recoverAdmission: async (continuationKey) => {
        recoveredKeys.push(continuationKey);
        if (continuationKey === poisonedKey) throw new Error("poisoned active delivery");
        return Result.ok(undefined);
      },
      confirm: async () => true,
      complete: async () => "missing",
      keys: async () => [poisonedKey, delivery.continuationKey],
      readyKeys: async () => [],
      parked: async () => Result.ok(undefined),
      depth: async () => 0,
      beginReset: async () => "00000000-0000-4000-8000-000000000099",
      commitReset: async () => true,
      purge: async () => {},
    },
    {
      emit: () => {},
      captureDefect: (_error, context) => {
        defects.push(`${context.op}:${String(context.attributes?.["continuationKey"])}`);
      },
    },
  );

  await flow.sweep();

  expect(recoveredKeys).toEqual([poisonedKey, delivery.continuationKey]);
  expect(claimedKeys).toEqual([delivery.continuationKey]);
  expect(defects).toContain(`agent.router.recover-queue:${poisonedKey}`);
  await flow.stop();
});
