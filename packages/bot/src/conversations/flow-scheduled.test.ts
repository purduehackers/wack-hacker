import { expect, test } from "bun:test";

import type { ConversationStore } from "@repo/shared/conversations";
import { Result } from "@repo/shared/result";
import { silentReporter } from "@repo/shared/result/observe";
import type { ScheduledFirePayload } from "@repo/shared/wire";

import type { AgentClient } from "../agent/client.ts";
import { createConversationFlow } from "./flow.ts";

const payload: ScheduledFirePayload = {
  scheduleId: "00000000-0000-4000-8000-000000000002",
  occurrenceId: "abcdefghijklmnopqrstuv",
  ownerId: "10000000000000000",
  channelId: "20000000000000000",
  description: "post an update",
  actionType: "message",
  prompt: "The update",
  attemptNumber: 1,
  finalAttempt: false,
  scheduledFor: "2026-01-01T00:00:00.000Z",
};

function eve(): AgentClient {
  return {
    sendMessage: async () => Result.ok({ sessionId: "session-1", continuationToken: "key" }),
    sendInteraction: async () => Result.ok({ sessionId: "session-1", continuationToken: "key" }),
    sendReset: async () => Result.ok(undefined),
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (cause) {
    return cause;
  }
  throw new Error("expected promise to reject");
}

test("scheduled admission completes a durable receipt before accepting a duplicate", async () => {
  let accepted = false;
  let admissions = 0;
  const flow = createConversationFlow({
    eve: eve(),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
    store: {
      scheduledFires: {
        claim: async () => (accepted ? "accepted" : "acquired"),
        complete: async () => {
          accepted = true;
          return true;
        },
        release: async () => {},
      },
    } as unknown as ConversationStore,
    rest: {
      postMessage: async () => Result.ok({ id: "50000000000000000", content: "" }),
      editMessage: async () => Result.ok(undefined),
      deleteMessage: async () => Result.ok(undefined),
      reply: async () => Result.ok({ id: "50000000000000000", content: "" }),
    },
    turnMessages: { record: async () => Result.ok(undefined) },
    schedules: {
      admit: async () => {
        admissions += 1;
      },
    },
    reporter: silentReporter,
  });

  await flow.admitSchedule(payload);
  await flow.admitSchedule(payload);
  expect(admissions).toBe(1);
  expect(accepted).toBeTrue();
});

test("failed scheduled admission releases only its forwarding claim", async () => {
  const released: { occurrenceId: string; claimToken: string }[] = [];
  const flow = createConversationFlow({
    eve: eve(),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- intentionally minimal strict fake
    store: {
      scheduledFires: {
        claim: async () => "acquired",
        complete: async () => false,
        release: async (occurrenceId: string, claimToken: string) => {
          released.push({ occurrenceId, claimToken });
        },
      },
    } as unknown as ConversationStore,
    rest: {
      postMessage: async () => Result.ok({ id: "50000000000000000", content: "" }),
      editMessage: async () => Result.ok(undefined),
      deleteMessage: async () => Result.ok(undefined),
      reply: async () => Result.ok({ id: "50000000000000000", content: "" }),
    },
    turnMessages: { record: async () => Result.ok(undefined) },
    schedules: {
      admit: async () => {
        throw new Error("Discord unavailable");
      },
    },
    reporter: silentReporter,
  });

  expect(await rejectionOf(flow.admitSchedule(payload))).toEqual(
    expect.objectContaining({ message: "Discord unavailable" }),
  );
  expect(released).toHaveLength(1);
  expect(released[0]?.occurrenceId).toBe(payload.occurrenceId);
});
