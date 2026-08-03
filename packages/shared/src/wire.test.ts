import { expect, test } from "vitest";

import { Result } from "./result/index.ts";
import {
  continuationKeyFor,
  decodeInteractionPayload,
  decodeMessagePayload,
  decodeParkedPayload,
  decodeReactionPayload,
} from "./wire.ts";

const CHANNEL = "904896819165814794";
const THREAD = "1052236377338683514";
const USER = "772576325897945119";
const MESSAGE = "1020777328172859412";

const principal = {
  userId: USER,
  username: "ray",
  nickname: "ray",
  memberRoles: ["1012751663322382438"],
} as const;

function mention(overrides: Record<string, unknown> = {}) {
  return {
    kind: "mention",
    continuationKey: THREAD,
    content: "what linear issues are open?",
    messageId: MESSAGE,
    principal,
    channel: { id: CHANNEL, name: "bot-test" },
    ...overrides,
  };
}

test("a well-formed mention decodes", () => {
  const decoded = decodeMessagePayload(mention());

  expect(Result.isOk(decoded)).toBe(true);
  expect(Result.isOk(decoded) && decoded.value.kind).toBe("mention");
});

test("decode reports every failing path at once, not just the first", () => {
  const decoded = decodeMessagePayload({
    kind: "shout",
    continuationKey: "not-a-snowflake",
    content: "hi",
    messageId: MESSAGE,
    principal: { ...principal, userId: "nope" },
    channel: { id: CHANNEL, name: "bot-test" },
  });

  expect(Result.isError(decoded)).toBe(true);
  if (!Result.isError(decoded)) return;

  const { issues } = decoded.error.props;
  // A caller fixing a payload should not have to round-trip once per field.
  expect(issues.length).toBeGreaterThan(2);
  expect(issues.join("\n")).toContain("continuationKey");
  expect(issues.join("\n")).toContain("principal.userId");
  expect(issues.join("\n")).toContain("kind");
});

test("a missing required field is rejected rather than defaulted", () => {
  const { principal: _omitted, ...withoutPrincipal } = mention();
  const decoded = decodeMessagePayload(withoutPrincipal);

  expect(Result.isError(decoded)).toBe(true);
});

test("unknown extra keys are stripped, so an old bot can talk to a new agent", () => {
  const decoded = decodeMessagePayload(mention({ somethingNew: "ignored" }));

  expect(Result.isOk(decoded)).toBe(true);
  expect(Result.isOk(decoded) && "somethingNew" in decoded.value).toBe(false);
});

test("content is bounded at Discord's own message ceiling", () => {
  expect(Result.isOk(decodeMessagePayload(mention({ content: "x".repeat(4_000) })))).toBe(true);
  expect(Result.isError(decodeMessagePayload(mention({ content: "x".repeat(4_001) })))).toBe(true);
});

test("empty content is allowed: a bare mention is a real turn", () => {
  expect(Result.isOk(decodeMessagePayload(mention({ content: "" })))).toBe(true);
});

test("optional lead-in context round-trips", () => {
  const decoded = decodeMessagePayload(
    mention({
      thread: { id: THREAD, parentId: CHANNEL, parentName: "ship" },
      recentMessages: ["a", "b"],
      referencedContext: ["anchor"],
      anchorMessageId: MESSAGE,
      attachments: [{ url: "https://cdn.example.com/a.png", filename: "a.png", size: 12 }],
    }),
  );

  expect(Result.isOk(decoded)).toBe(true);
  if (!Result.isOk(decoded)) return;
  expect(decoded.value.thread?.parentName).toBe("ship");
  expect(decoded.value.attachments).toHaveLength(1);
});

test("an attachment must carry a real URL", () => {
  const decoded = decodeMessagePayload(
    mention({ attachments: [{ url: "not-a-url", filename: "a.png", size: 1 }] }),
  );

  expect(Result.isError(decoded)).toBe(true);
});

test("reaction intents are constrained to the two the agent understands", () => {
  const base = { continuationKey: THREAD, messageId: MESSAGE, emoji: "✅", principal };

  expect(Result.isOk(decodeReactionPayload({ ...base, intent: "done" }))).toBe(true);
  expect(Result.isOk(decodeReactionPayload({ ...base, intent: "feedback" }))).toBe(true);
  expect(Result.isError(decodeReactionPayload({ ...base, intent: "sparkle" }))).toBe(true);
});

test("an interaction carries the clicker, who may differ from the requester", () => {
  const clicker = { ...principal, userId: "1344066433172373656", username: "someone-else" };
  const decoded = decodeInteractionPayload({
    continuationKey: THREAD,
    requestId: "req_1",
    decision: "approve",
    principal: clicker,
  });

  expect(Result.isOk(decoded)).toBe(true);
  // Second-party approval depends on being able to tell these apart.
  expect(Result.isOk(decoded) && decoded.value.principal.userId).not.toBe(principal.userId);
});

test("the parked callback carries only what the bot needs to drain a queue", () => {
  const decoded = decodeParkedPayload({ continuationKey: THREAD, sessionId: "ses_01h" });

  expect(Result.isOk(decoded)).toBe(true);
  expect(Result.isError(decodeParkedPayload({ continuationKey: THREAD }))).toBe(true);
});

test("continuationKeyFor prefers the thread so parallel threads never collide", () => {
  expect(continuationKeyFor({ channelId: CHANNEL, threadId: THREAD })).toBe(THREAD);
  expect(continuationKeyFor({ channelId: CHANNEL })).toBe(CHANNEL);
});

test("a decoded payload survives a JSON round trip unchanged", () => {
  const payload = mention({ recentMessages: ["a"] });
  const first = decodeMessagePayload(payload);
  const second = decodeMessagePayload(JSON.parse(JSON.stringify(payload)));

  expect(Result.isOk(first) && Result.isOk(second) && first.value).toEqual(
    Result.isOk(second) ? second.value : undefined,
  );
});
