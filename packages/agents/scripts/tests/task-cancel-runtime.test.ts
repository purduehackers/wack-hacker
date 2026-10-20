import { expect, test } from "bun:test";

import { installedCancelProbe } from "./fixtures/cancel-runtime.ts";

test("installed Eve fixed-session handle preserves turn targeting while a newer turn is active", async () => {
  const observed = await installedCancelProbe();
  expect(observed.sent[0]).toEqual({
    sessionId: "exact-session",
    command: { kind: "cancel", turnId: "older-turn" },
  });
  expect(observed.newerTurnAborted).toBe(false);
  expect(observed.matchedTurnAborted).toBe(true);
});

test("release blocker: Eve 0.81.1 idle owner ignores the target turn when cancelling working tasks", async () => {
  const observed = await installedCancelProbe();
  expect(observed.idleOutcome).toEqual({ kind: "cancel-working-tasks" });
});
