import { expect, test } from "bun:test";

import type { ConversationStore, HitlClaimInput } from "@repo/shared/conversations";
import { Result } from "@repo/shared/result";
import type { WideEvent } from "@repo/shared/result/observe";
import type { InteractionPayload } from "@repo/shared/wire";

import type { AgentClient } from "../agent/client.ts";
import { createConversationFlow } from "./flow.ts";

const claim: HitlClaimInput = {
  dispatchId: "00000000-0000-4000-8000-000000000001",
  continuationKey: "30000000000000000",
  revision: 3,
  requestIndex: 0,
  requestId: "request-1",
  recipientUserId: "10000000000000000",
  interactionId: "60000000000000000",
};
const payload: InteractionPayload = {
  continuationKey: claim.continuationKey,
  interactionId: claim.interactionId,
  dispatchId: claim.dispatchId,
  renderRevision: claim.revision,
  requestId: claim.requestId,
  authChannelId: claim.continuationKey,
  optionId: "yes",
  principal: {
    userId: claim.recipientUserId,
    username: "requester",
    nickname: "Requester",
    memberRoles: [],
  },
};

test("HITL answer preserves the claim revision through durable completion", async () => {
  const completions: unknown[][] = [];
  const events: WideEvent[] = [];
  const store = {
    hitl: {
      claim: async () => "acquired",
      complete: async (...args: unknown[]) => {
        completions.push(args);
        return false;
      },
    },
  } as unknown as ConversationStore;
  const eve: AgentClient = {
    sendMessage: async () =>
      Result.ok({ sessionId: "session-1", continuationToken: claim.continuationKey }),
    sendInteraction: async () =>
      Result.ok({ sessionId: "session-1", continuationToken: claim.continuationKey }),
    sendReset: async () => Result.ok(undefined),
  };
  const flow = createConversationFlow({
    eve,
    store,
    rest: {} as never,
    turnMessages: {} as never,
    schedules: {} as never,
    reporter: {
      emit: (event) => events.push(event),
      captureDefect: (_error, context) =>
        events.push({ op: context.op, status: "defect", attributes: context.attributes ?? {} }),
    },
  });

  expect(await flow.answer({ claim, payload })).toEqual({ status: "accepted" });
  expect(completions).toEqual([[claim.dispatchId, claim.revision, claim.interactionId]]);
  expect(events).toContainEqual({
    op: "agent.hitl.complete",
    status: "defect",
    attributes: { dispatchId: claim.dispatchId, interactionId: claim.interactionId },
  });
});
