import { describe, expect, test } from "bun:test";

import {
  decodeAuthorizationChallenge,
  decodeDeliveryPayload,
  decodeInteractionPayload,
  decodeScheduledFirePayload,
} from "./wire.ts";

const principal = {
  userId: "10000000000000000",
  username: "member",
  nickname: "Member",
  memberRoles: ["20000000000000000"],
};

const delivery = {
  kind: "mention",
  continuationKey: "30000000000000000",
  content: "hello",
  messageId: "40000000000000000",
  principal,
  channel: { id: "30000000000000000", name: "bot-test" },
  dispatchId: "00000000-0000-4000-8000-000000000000",
};

describe("bot-agent wire validation", () => {
  test("accepts a strict Discord delivery", () => {
    expect(decodeDeliveryPayload(delivery).status).toBe("ok");
  });

  test("rejects unknown authority-bearing fields", () => {
    expect(decodeDeliveryPayload({ ...delivery, role: "admin" }).status).toBe("error");
  });

  test("requires both durable schedule locators only for scheduled turns", () => {
    expect(decodeDeliveryPayload({ ...delivery, scheduleId: crypto.randomUUID() }).status).toBe(
      "error",
    );
    expect(
      decodeDeliveryPayload({
        ...delivery,
        kind: "scheduled",
        scheduleId: crypto.randomUUID(),
        occurrenceId: "abcdefghijklmnopqrstuv",
      }).status,
    ).toBe("ok");
  });

  test("requires retry metadata for scheduled-fire remediation", () => {
    const scheduled = {
      scheduleId: crypto.randomUUID(),
      occurrenceId: "abcdefghijklmnopqrstuv",
      ownerId: principal.userId,
      channelId: delivery.channel.id,
      description: "Reminder",
      actionType: "agent",
      prompt: "Post the reminder",
      memberRoles: principal.memberRoles,
      attemptNumber: 5,
      finalAttempt: true,
      scheduledFor: "2026-01-01T00:00:00.000Z",
    };
    expect(decodeScheduledFirePayload(scheduled).status).toBe("ok");
    const { finalAttempt: _finalAttempt, ...missingRemediation } = scheduled;
    expect(decodeScheduledFirePayload(missingRemediation).status).toBe("error");
  });

  test("accepts only private HTTPS authorization challenges", () => {
    expect(
      decodeAuthorizationChallenge({ description: "Connect", url: "http://example.com/token" })
        .status,
    ).toBe("error");
    expect(
      decodeAuthorizationChallenge({ description: "Connect", url: "https://example.com/token" })
        .status,
    ).toBe("ok");
  });

  test("rejects self-attributed second-party approval projections", () => {
    expect(
      decodeInteractionPayload({
        continuationKey: delivery.continuationKey,
        interactionId: "50000000000000000",
        dispatchId: delivery.dispatchId,
        renderRevision: 1,
        requestId: "request-1",
        authChannelId: delivery.channel.id,
        optionId: "approve",
        principal,
        approvalRequester: { userId: principal.userId, memberRoles: principal.memberRoles },
      }).status,
    ).toBe("error");
  });
  test("accepts only valid W3C trace context on durable deliveries", () => {
    const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    expect(decodeDeliveryPayload({ ...delivery, traceparent }).status).toBe("ok");
    expect(decodeDeliveryPayload({ ...delivery, traceparent: "not-a-trace" }).status).toBe("error");
    expect(
      decodeDeliveryPayload({
        ...delivery,
        traceparent: "00-00000000000000000000000000000000-0123456789abcdef-01",
      }).status,
    ).toBe("error");
  });
});
