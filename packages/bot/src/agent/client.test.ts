import { expect, test } from "bun:test";

import { Result } from "@repo/shared/result";
import type { CancelRequestPayload, DeliveryPayload } from "@repo/shared/wire";

import { createAgentClient } from "./client.ts";

const principal = {
  userId: "100000000000000001",
  username: "requester",
  nickname: "Requester",
  memberRoles: [],
};
const delivery: DeliveryPayload = {
  kind: "mention",
  dispatchId: "11e101e0-36a7-4d5b-a194-9745530ca24a",
  continuationKey: "100000000000000002",
  messageId: "100000000000000003",
  channel: { id: "100000000000000002", name: "test" },
  principal,
  content: "Do the work",
};
const cancel: CancelRequestPayload = {
  continuationKey: delivery.continuationKey,
  dispatchId: delivery.dispatchId,
  sessionId: "session",
  eveTurnId: "turn",
  renderRevision: 1,
  anchorMessageId: "100000000000000004",
  channelId: delivery.channel.id,
  interactionId: "100000000000000005",
  principal,
};

test("ambiguous new-message admission and unscoped steering are never retried", async () => {
  const bodies: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      bodies.push(await request.text());
      return new Response("uncertain admission", { status: 503 });
    },
  });
  try {
    const client = createAgentClient({ baseUrl: server.url.toString(), secret: "test" });
    expect(Result.isError(await client.sendMessage(delivery))).toBe(true);
    expect(bodies).toEqual([JSON.stringify(delivery)]);
    const steer = { continuationKey: delivery.continuationKey };
    expect(Result.isError(await client.sendSteer(steer))).toBe(true);
    expect(bodies).toEqual([JSON.stringify(delivery), JSON.stringify(steer)]);
  } finally {
    await server.stop(true);
  }
});

test("idempotent commands retry once, preserve exact request bytes, and remain bounded", async () => {
  const seen: { path: string; body: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      seen.push({ path: new URL(request.url).pathname, body: await request.text() });
      return new Response("temporary failure", { status: 503 });
    },
  });
  try {
    const client = createAgentClient({ baseUrl: server.url.toString(), secret: "test" });
    const reset = {
      continuationKey: delivery.continuationKey,
      resetId: "12e101e0-36a7-4d5b-a194-9745530ca24a",
      reason: "Requested reset",
      principal,
    };
    const interaction = {
      continuationKey: delivery.continuationKey,
      dispatchId: delivery.dispatchId,
      interactionId: "100000000000000006",
      renderRevision: 1,
      requestId: "request",
      authChannelId: delivery.channel.id,
      optionId: "approve",
      principal,
    };
    expect(Result.isError(await client.sendReset(reset))).toBe(true);
    expect(Result.isError(await client.sendInteraction(interaction))).toBe(true);
    expect(Result.isError(await client.sendCancel(cancel))).toBe(true);
    expect(seen).toHaveLength(6);
    for (let index = 0; index < seen.length; index += 2)
      expect(seen[index]).toEqual(seen[index + 1]);
  } finally {
    await server.stop(true);
  }
});

test("permanent cancellation rejection is not retried", async () => {
  let attempts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      attempts += 1;
      return new Response("forbidden", { status: 403 });
    },
  });
  try {
    const client = createAgentClient({ baseUrl: server.url.toString(), secret: "test" });
    expect(Result.isError(await client.sendCancel(cancel))).toBe(true);
    expect(attempts).toBe(1);
  } finally {
    await server.stop(true);
  }
});
