import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  discordRESTClass,
  handlerCtx,
  linearClientClass,
  messagePacket,
  notionClientClass,
  octokitClass,
  resendClass,
} from "@/lib/test/fixtures";

const hoisted = vi.hoisted(() => ({
  resumeHook: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue({ runId: "run-1" }),
}));

vi.mock("workflow/api", () => ({
  resumeHook: hoisted.resumeHook,
  start: hoisted.start,
}));

// Third-party SDK mocks — handlers.ts transitively loads streaming →
// orchestrator → real tool modules that instantiate SDK clients on import.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const { router } = await import("./handlers");

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

    expect(hoisted.resumeHook).not.toHaveBeenCalled();
  });

  it("forwards non-mention messages in a channel with an active conversation", async () => {
    const ctx = handlerCtx(BOT);
    await ctx.store.set({
      workflowRunId: "wf-2",
      channelId: "ch-1",
      startedAt: new Date().toISOString(),
    });

    await router.dispatch(messagePacket("hello"), ctx);

    expect(hoisted.resumeHook).toHaveBeenCalledOnce();
  });
});
