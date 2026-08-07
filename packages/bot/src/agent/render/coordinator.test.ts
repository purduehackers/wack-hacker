import { describe, expect, test } from "bun:test";

import { Result } from "@repo/shared/result";
import { silentReporter } from "@repo/shared/result/observe";
import type { RenderIntent, RenderTarget } from "@repo/shared/wire";

import { createRenderCoordinator } from "./coordinator.ts";

const dispatchId = "00000000-0000-4000-8000-000000000000";
const continuationKey = "30000000000000000";
const intent: RenderIntent = {
  dispatchId,
  continuationKey,
  messageId: "40000000000000000",
  sessionId: "session-1",
  eveTurnId: "turn-1",
  revision: 4,
  phase: "completed",
  text: "Done",
  activity: "",
};
const target: RenderTarget = {
  dispatchId,
  continuationKey,
  messageId: intent.messageId,
  channelId: continuationKey,
  authChannelId: continuationKey,
  requesterUserId: "10000000000000000",
  anchorMessageId: "50000000000000000",
};

describe("Discord render recovery", () => {
  test("startup sweep settles a durable ready intent and releases a pre-start flush waiter", async () => {
    let outcome: "applied" | undefined;
    let completions = 0;
    const coordinator = createRenderCoordinator({
      rest: {
        postMessage: async () => Result.ok({ id: "50000000000000000", content: "Done" }),
        editMessage: async () => Result.ok(undefined),
        deleteMessage: async () => Result.ok(undefined),
        reply: async () => Result.ok({ id: "50000000000000000", content: "Done" }),
      },
      store: {
        claim: async () => "claim-1",
        renew: async () => true,
        intent: async () => Result.ok(intent),
        authorization: async () => Result.ok(undefined),
        target: async () => Result.ok(target),
        projection: async () =>
          Result.ok({
            anchorMessageId: "50000000000000000",
            overflow: [],
            appliedRevision: intent.revision,
          }),
        checkpoint: async () => true,
        complete: async () => {
          completions += 1;
          outcome = "applied";
          return "caught-up";
        },
        release: async () => {},
        outcome: async () => outcome,
        ready: async () => [dispatchId],
        discard: async () => {},
      },
      turnMessages: { record: async () => Result.ok(undefined) },
      reporter: silentReporter,
      recoveryIntervalMs: 0,
    });

    const flushed = coordinator.flush(dispatchId);
    await coordinator.start();

    expect(await flushed).toBe(true);
    expect(completions).toBe(1);
    await coordinator.stop();
  });
});
