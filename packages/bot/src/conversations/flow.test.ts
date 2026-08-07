import { describe, expect, test } from "bun:test";

import type { ConversationStore } from "@repo/shared/conversations";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { silentReporter } from "@repo/shared/result/observe";
import type {
  DeliveryPayload,
  InteractionPayload,
  ParkedPayload,
  ResetRequestPayload,
} from "@repo/shared/wire";

import type { AgentClient } from "../agent/client.ts";
import { createConversationFlow } from "./flow.ts";

const continuationKey = "30000000000000000";
const parked: ParkedPayload = {
  continuationKey,
  sessionId: "session-1",
  messageId: "40000000000000000",
  dispatchId: "00000000-0000-4000-8000-000000000000",
  eveTurnId: "turn-1",
};
const delivery: DeliveryPayload = {
  kind: "followup",
  continuationKey,
  content: "after reset",
  messageId: "40000000000000001",
  principal: {
    userId: "10000000000000000",
    username: "requester",
    nickname: "Requester",
    memberRoles: [],
  },
  channel: { id: continuationKey, name: "agent-thread" },
  dispatchId: "00000000-0000-4000-8000-000000000001",
};

function flowHarness(
  eve: AgentClient,
  queue: ConversationStore["queue"],
  outcome: () => Promise<"applied" | "discarded" | undefined> = async () => undefined,
) {
  return createConversationFlow({
    eve,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
    store: {
      queue,
      render: { ready: async () => [], outcome },
    } as unknown as ConversationStore,
    rest: {
      postMessage: async () => Result.ok({ id: "50000000000000000", content: "" }),
      editMessage: async () => Result.ok(undefined),
      deleteMessage: async () => Result.ok(undefined),
      reply: async () => Result.ok({ id: "50000000000000000", content: "" }),
    },
    turnMessages: { record: async () => Result.ok(undefined) },
    schedules: { admit: async () => {} },
    reporter: silentReporter,
    recoveryIntervalMs: 0,
  });
}

describe("agent router durable recovery", () => {
  test("replays a parked marker but does not advance until terminal paint has an outcome", async () => {
    let visible = false;
    let completions = 0;
    const router = flowHarness(
      {
        sendMessage: async (_delivery: DeliveryPayload) =>
          Result.ok({ sessionId: "session-1", continuationToken: continuationKey }),
        sendInteraction: async (_interaction: InteractionPayload) =>
          Result.ok({ sessionId: "session-1", continuationToken: continuationKey }),
        sendReset: async (_reset: ResetRequestPayload) => Result.ok(undefined),
      },
      {
        enqueue: async () => {},
        claim: async () => Result.ok(undefined),
        recoverAdmission: async () => Result.ok(undefined),
        confirm: async () => true,
        complete: async () => {
          completions += 1;
          return "completed";
        },
        keys: async () => [],
        readyKeys: async () => [continuationKey],
        parked: async () => Result.ok(parked),
        depth: async () => 0,
        beginReset: async () => "00000000-0000-4000-8000-000000000099",
        commitReset: async () => true,
        purge: async () => {},
      },
      async () => (visible ? "applied" : undefined),
    );

    await router.sweep();
    expect(completions).toBe(0);

    visible = true;
    await router.sweep();
    expect(completions).toBe(1);
    await router.stop();
  });
});

describe("agent router reset recovery", () => {
  test("reuses an ambiguous reset barrier and delivers the next generation after commit", async () => {
    const resetId = "00000000-0000-4000-8000-000000000099";
    const resetCalls: ResetRequestPayload[] = [];
    let resetAttempts = 0;
    let committed = false;
    let delivered = 0;
    let confirmations = 0;
    let claimed = false;
    const router = flowHarness(
      {
        sendMessage: async (_delivery: DeliveryPayload) => {
          delivered += 1;
          return Result.ok({ sessionId: "session-2", continuationToken: continuationKey });
        },
        sendInteraction: async (_interaction: InteractionPayload) =>
          Result.ok({ sessionId: "session-1", continuationToken: continuationKey }),
        sendReset: async (resetRequest: ResetRequestPayload) => {
          resetCalls.push(resetRequest);
          resetAttempts += 1;
          return resetAttempts === 1
            ? Result.err(new Transient({ operation: "reset", detail: "response lost" }))
            : Result.ok(undefined);
        },
      },
      {
        enqueue: async () => {},
        claim: async () => {
          if (!committed || claimed) return Result.ok(undefined);
          claimed = true;
          return Result.ok({ payload: delivery, claimToken: "claim-1" });
        },
        recoverAdmission: async () => Result.ok(undefined),
        confirm: async () => {
          confirmations += 1;
          return true;
        },
        complete: async () => "missing",
        keys: async () => [],
        readyKeys: async () => [],
        parked: async () => Result.ok(undefined),
        depth: async () => 1,
        beginReset: async () => resetId,
        commitReset: async (_key: string, candidate: string) => {
          committed = candidate === resetId;
          return committed;
        },
        purge: async () => {},
      },
    );
    const resetCommand = {
      continuationKey,
      reason: "start fresh",
      principal: delivery.principal,
    };

    expect(Result.isError(await router.reset(resetCommand))).toBe(true);
    expect(committed).toBe(false);
    expect(Result.isOk(await router.reset(resetCommand))).toBe(true);
    expect(resetCalls.map(({ resetId: candidate }) => candidate)).toEqual([resetId, resetId]);
    expect(delivered).toBe(1);
    expect(confirmations).toBe(1);
    await router.stop();
  });
});
