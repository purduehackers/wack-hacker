import { expect, test } from "bun:test";

import {
  appendStreamingDelta,
  appendStreamingMessage,
  beginDiscordTurn,
  completeStreamingMessage,
  initialDiscordState,
  isWaitingForHuman,
  resolveDiscordInputs,
} from "../../agent/lib/discord/state.ts";

test("delta streaming preserves complete blocks and restores its checkpoint on retry", () => {
  const state = initialDiscordState();
  appendStreamingDelta(state, { messageDelta: "Checking " });
  appendStreamingDelta(state, { messageDelta: "that." });
  expect(state.text).toBe("Checking that.");
  completeStreamingMessage(state, { message: "Checking that." });
  const checkpoint = structuredClone(state);
  appendStreamingDelta(state, { messageDelta: "Partial interrupted output" });
  const restored = structuredClone(checkpoint);
  appendStreamingDelta(restored, { messageDelta: "It is " });
  appendStreamingDelta(restored, { messageDelta: "ready." });
  completeStreamingMessage(restored, { message: "It is ready." });
  completeStreamingMessage(restored, { message: "It is ready." });
  expect(restored.text).toBe("Checking that.\n\nIt is ready.");
  expect(restored.finalRenderPhase).toBeUndefined();
  expect(restored.renderSettled).toBe(false);
});

test("legacy accepted input starts a turn and retires its controls through projection state", () => {
  const state = initialDiscordState();
  state.pendingInputRequestIds = ["legacy-approval"];
  state.renderInputRequests = [
    {
      requestId: "legacy-approval",
      recipientUserId: "requester",
      kind: "tool-approval",
      prompt: "Approve?",
    },
  ];
  beginDiscordTurn(state, { discordInputRequestId: "legacy-approval" }, 123);
  expect(state.pendingInputRequestIds).toEqual([]);
  expect(state.renderInputRequests).toEqual([]);
  expect(state.renderSettled).toBe(false);
});

test("legacy cumulative frames remain idempotent", () => {
  const state = initialDiscordState();
  appendStreamingMessage(state, { messageSoFar: "Checking" });
  appendStreamingMessage(state, { messageSoFar: "Checking" });
  expect(state.text).toBe("Checking");
});

test("in-call answers clear only resolved controls without ending the open turn", () => {
  const state = initialDiscordState();
  state.activeEveTurnId = "held-turn";
  state.pendingInputRequestIds = ["one", "two"];
  state.renderInputRequests = ["one", "two"].map((requestId) => ({
    requestId,
    recipientUserId: "requester",
    kind: "question",
    prompt: "Which one?",
  }));
  resolveDiscordInputs(state, ["one"]);
  expect(isWaitingForHuman(state)).toBe(true);
  expect(state.renderInputRequests.map(({ requestId }) => requestId)).toEqual(["two"]);
  resolveDiscordInputs(state, ["two"]);
  expect(isWaitingForHuman(state)).toBe(false);
  expect(state.activeEveTurnId).toBe("held-turn");
  expect(state.finalRenderPhase).toBeUndefined();
  expect(state.renderSettled).toBe(false);
});
