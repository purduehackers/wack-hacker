import { expect, test } from "bun:test";

import { renderProjectionSchema } from "@repo/shared/conversations";
import { stored } from "@repo/shared/json";
import type { RenderIntent, RenderTarget } from "@repo/shared/wire";

import {
  needsWorkCard,
  parseWorkCardCustomId,
  publicFooter,
  renderWorkCard,
  workCardCustomId,
  workCardState,
  workCardTitle,
} from "./work-card.ts";

const intent: RenderIntent = {
  dispatchId: "c9b24619-5475-4e40-aeb0-803eeb06df88",
  continuationKey: "100000000000000001",
  messageId: "100000000000000002",
  sessionId: "session-example",
  eveTurnId: "turn-example",
  revision: 1,
  phase: "streaming",
  text: "Found the event. Checking its images.",
  activity: "",
};
const target: RenderTarget = {
  ...intent,
  channelId: "100000000000000001",
  authChannelId: "100000000000000001",
  requesterUserId: "100000000000000003",
};

test("quick answers stay plain; tools, long responses, failures and requests promote", () => {
  expect(needsWorkCard(intent)).toBe(false);
  expect(needsWorkCard({ ...intent, activity: "thinking…" })).toBe(false);
  expect(needsWorkCard({ ...intent, phase: "completed" })).toBe(false);
  expect(needsWorkCard({ ...intent, activity: "calling events_list…" })).toBe(true);
  expect(needsWorkCard({ ...intent, text: "x".repeat(1_501) })).toBe(true);
  expect(needsWorkCard({ ...intent, phase: "failed" })).toBe(true);
  expect(needsWorkCard(intent, "cms: Checking images")).toBe(true);
});

test("existing lifecycle and HITL values determine each supported state", () => {
  const question = {
    requestId: "choose-image",
    recipientUserId: target.requesterUserId,
    prompt: "Which image?",
    kind: "question",
    allowFreeform: true,
  } as const;
  expect(workCardState(intent)).toBe("working");
  expect(workCardState({ ...intent, inputRequests: [question] })).toBe("input");
  expect(
    workCardState({ ...intent, inputRequests: [{ ...question, kind: "tool-approval" }] }),
  ).toBe("approval");
  expect(workCardState({ ...intent, phase: "completed", inputRequests: [question] })).toBe("ready");
  expect(workCardState({ ...intent, phase: "failed", inputRequests: [question] })).toBe("failed");
});

test("a work card preserves useful streaming and removes raw tool and usage clutter", () => {
  const card = renderWorkCard({
    intent: {
      ...intent,
      activity: "calling cms_list_media",
      footer: "`abc123` · 12.0s · 4,100 tokens · 3 tool calls",
    },
    target,
    title: "Update Hack Night",
    progress: "cms: Checking the event's images",
  });
  expect(card.text).toContain("Working");
  expect(card.text).toContain(intent.text);
  expect(card.text).toContain("Checking the event's images");
  expect(card.text).not.toContain("cms_list_media");
  expect(card.text).not.toContain("tokens");
  expect(card.text).not.toContain("cms:");
  expect(card.components[0]?.components.map((button) => button.label)).toEqual(["Details"]);
});

test("long answers have a bounded card and a functional full-result locator", () => {
  const card = renderWorkCard({
    intent: { ...intent, text: "🪿".repeat(6_000) },
    target,
    title: "Research",
  });
  expect(card.text.length).toBeLessThanOrEqual(1_900);
  expect(card.text).toContain("Full result");
  expect(card.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
  expect(card.components[0]?.components[0]?.custom_id).toBe(
    workCardCustomId(intent.dispatchId, 1, "result"),
  );
  expect(parseWorkCardCustomId(card.components[0]?.components[0]?.custom_id ?? "")).toEqual({
    dispatchId: intent.dispatchId,
    revision: 1,
    action: "result",
  });
});

test("terminal cards do not confuse response completion with task success", () => {
  const card = renderWorkCard({
    intent: { ...intent, phase: "completed" },
    target,
    title: "Research",
  });
  expect(card.text).toContain("Response ready");
  expect(card.text).not.toContain("Complete");
  const failed = renderWorkCard({
    intent: {
      ...intent,
      phase: "failed",
      text: "",
      footer: "session ended unexpectedly — reference 123abc",
    },
    target,
    title: "Research",
  });
  expect(failed.text).toContain("Stopped — needs attention");
  expect(failed.text).toContain("session ended unexpectedly");
  expect(failed.text).not.toContain("123abc");
});

test("clipped code examples close before the full-result hint without changing the saved result", () => {
  const text = `Here is the code:\n\n\`\`\`ts\n${"const answer = 42;\n".repeat(200)}\`\`\``;
  const card = renderWorkCard({ intent: { ...intent, text }, target, title: "Code" });
  expect(card.text.length).toBeLessThanOrEqual(1_900);
  expect(card.text).toContain("\n```\n\n-# Open Full result");
  expect(card.fullResult).toBe(text);
});

test("recovery and cancellation instructions survive diagnostic filtering", () => {
  expect(
    publicFooter(
      "React ✅ to this message to reset the conversation before retrying, or start a new thread.",
    ),
  ).toContain("React ✅");
  expect(publicFooter("Send the message again to retry.")).toBe("Send the message again to retry.");
  expect(publicFooter("Stopped at your request.")).toBe("Stopped at your request.");
  expect(publicFooter("`abc123` · 12.0s · 10 tokens")).toBeUndefined();
});

test("request titles are bounded and escaped, not interpreted as Markdown", () => {
  const title = workCardTitle(
    JSON.stringify({ content: "**Hello**\n# everybody " + "🪿".repeat(100) }),
  );
  expect(title).toStartWith("\\*\\*Hello\\*\\*");
  expect(title).not.toContain("\n");
  expect(title.length).toBeLessThanOrEqual(120);
  expect(workCardTitle("unreadable")).toBe("Your request");
});

test("malformed, oversized and future-shaped controls are rejected by the locator", () => {
  for (const value of [
    "other:abc",
    `wack-work:${intent.dispatchId}:0:details`,
    `wack-work:${intent.dispatchId}:Infinity:details`,
    `wack-work:${intent.dispatchId}:9007199254740992:details`,
    `wack-work:${intent.dispatchId}:1:stop`,
    `wack-work:${intent.dispatchId}:1:details:extra`,
  ]) {
    expect(parseWorkCardCustomId(value)).toBeUndefined();
  }
});

test("old and promoted projections round-trip without changing lifecycle data", () => {
  expect(
    renderProjectionSchema.parse({ overflow: [], appliedRevision: 0 }).workCard,
  ).toBeUndefined();
  const value = {
    overflow: [],
    appliedRevision: 2,
    anchorGeneration: 1,
    workCard: { title: "Research" },
  };
  expect(stored(renderProjectionSchema).parse(JSON.stringify(value))).toEqual(value);
});
