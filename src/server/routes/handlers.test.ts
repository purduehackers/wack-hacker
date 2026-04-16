import { describe, it, expect, vi, beforeEach } from "vitest";

import { handlerCtx, messagePacket } from "@/lib/test/fixtures";

vi.mock("workflow/api", () => ({
  resumeHook: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue({ runId: "run-1" }),
}));

vi.mock("@/bot/handlers/events", () => ({
  handleMention: vi.fn(),
}));

const { router } = await import("./handlers");
const { resumeHook } = await import("workflow/api");

const BOT = "bot-123";

describe("message handler – thread filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores non-mention messages inside a thread", async () => {
    const ctx = handlerCtx(BOT);
    await ctx.store.set({
      workflowRunId: "wf-1",
      channelId: "ch-1",
      threadId: "ch-1",
      startedAt: new Date().toISOString(),
    });

    await router.dispatch(
      messagePacket("hello", { thread: { parentId: "p1", parentName: "parent" } }),
      ctx,
    );

    expect(resumeHook).not.toHaveBeenCalled();
  });

  it("forwards non-mention messages in a channel with an active conversation", async () => {
    const ctx = handlerCtx(BOT);
    await ctx.store.set({
      workflowRunId: "wf-2",
      channelId: "ch-1",
      startedAt: new Date().toISOString(),
    });

    await router.dispatch(messagePacket("hello"), ctx);

    expect(resumeHook).toHaveBeenCalledOnce();
  });
});
