import { expect, test } from "bun:test";

import type { ParkedPayload, ScheduledFirePayload } from "@repo/shared/wire";
import type { Client } from "discord.js";

import { handleRequest, type ServerDeps } from "./server.ts";

const ingressSecret = "test-ingress-secret";
const client = {
  isReady: () => true,
  readyTimestamp: Date.now(),
  ws: { ping: 42 },
} as unknown as Client;

function request(path: string, body: unknown, secret = ingressSecret): Request {
  return new Request(`http://bot.test${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function harness() {
  const wakes: { readonly dispatchId?: string; readonly continuationKey?: string }[] = [];
  const scheduled: ScheduledFirePayload[] = [];
  const deps: ServerDeps = {
    port: 0,
    client,
    conversations: {
      wake: (hint) => wakes.push(hint),
      admitSchedule: async (payload) => {
        scheduled.push(payload);
      },
    },
    ingressSecret,
  };
  return { deps, wakes, scheduled };
}

test("internal parked callback validates, wakes render, and preserves the semantic payload", async () => {
  const state = harness();
  const payload: ParkedPayload = {
    continuationKey: "30000000000000000",
    sessionId: "session-1",
    messageId: "40000000000000000",
    dispatchId: "00000000-0000-4000-8000-000000000001",
    eveTurnId: "turn-1",
  };

  const response = await handleRequest(request("/internal/agent/parked", payload), state.deps);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(state.wakes).toEqual([
    { dispatchId: payload.dispatchId, continuationKey: payload.continuationKey },
  ]);
});

test("internal render callback rejects bad auth and malformed wakeups before dispatch", async () => {
  const state = harness();
  const unauthorized = await handleRequest(
    request(
      "/internal/agent/render",
      { dispatchId: "00000000-0000-4000-8000-000000000001" },
      "wrong-secret",
    ),
    state.deps,
  );
  expect(unauthorized.status).toBe(401);

  const malformed = await handleRequest(
    request("/internal/agent/render", { dispatchId: "not-a-uuid" }),
    state.deps,
  );
  expect(malformed.status).toBe(400);
  expect(state.wakes).toEqual([]);
});

test("internal scheduled callback accepts the strict scheduled occurrence", async () => {
  const state = harness();
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

  const response = await handleRequest(request("/internal/agent/scheduled", payload), state.deps);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ ok: true });
  expect(state.scheduled).toEqual([payload]);
});
