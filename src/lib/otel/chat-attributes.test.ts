import { describe, expect, it } from "vitest";

import type { SerializedAgentContext } from "@/lib/ai/types";

import { buildChatAttributes } from "./chat-attributes";

const baseContext: SerializedAgentContext = {
  userId: "u1",
  username: "alice",
  nickname: "Alice",
  channel: { id: "c1", name: "general" },
  date: "Jan 1, 2026",
};

describe("buildChatAttributes", () => {
  it("builds required keys from workflowRunId + context", () => {
    const attrs = buildChatAttributes({ workflowRunId: "run-1", context: baseContext });
    expect(attrs).toEqual({
      "chat.id": "run-1",
      "chat.channel_id": "c1",
      "chat.user_id": "u1",
    });
  });

  it("includes chat.thread_id when the context has a thread", () => {
    const attrs = buildChatAttributes({
      workflowRunId: "run-1",
      context: {
        ...baseContext,
        thread: { id: "t1", name: "thread", parentChannel: baseContext.channel },
      },
    });
    expect(attrs["chat.thread_id"]).toBe("t1");
  });

  it("includes chat.turn_index when provided", () => {
    const attrs = buildChatAttributes({
      workflowRunId: "run-1",
      context: baseContext,
      turnIndex: 3,
    });
    expect(attrs["chat.turn_index"]).toBe(3);
  });

  it("omits username (PII)", () => {
    const attrs = buildChatAttributes({ workflowRunId: "run-1", context: baseContext });
    expect(attrs).not.toHaveProperty("chat.username");
  });
});
