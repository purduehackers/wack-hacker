import { describe, it, expect, vi } from "vitest";

import type { TurnMessageRecord } from "@/bot/turn-message-store";

import { TurnMessageStore } from "@/bot/turn-message-store";
import { createMemoryRedis, reactionPacket } from "@/lib/test/fixtures";

const { emitted, loggerContexts } = vi.hoisted(() => ({
  emitted: vi.fn(),
  loggerContexts: [] as Record<string, unknown>[],
}));

vi.mock("evlog", () => ({
  createLogger: vi.fn((context: Record<string, unknown>) => {
    loggerContexts.push(context);
    return {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      emit: emitted,
      getContext: () => context,
    };
  }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  metrics: { count: vi.fn(), distribution: vi.fn() },
}));

import * as Sentry from "@sentry/nextjs";

import { createFeedbackHandler, feedback } from "./index";

const turnRecord: TurnMessageRecord = {
  chatId: "wf-run-1",
  traceId: "0af7651916cd43dd8448eb211c80319c",
  domains: ["linear"],
  channelId: "ch-1",
  userId: "user-9",
};

/** Store pre-indexed with a turn record for the fixture packet's `msg-1`. */
async function indexedStore(): Promise<TurnMessageStore> {
  const store = new TurnMessageStore(createMemoryRedis());
  await store.set("msg-1", turnRecord);
  return store;
}

function clearCaptures(): void {
  vi.mocked(Sentry.metrics.count).mockClear();
  emitted.mockClear();
  loggerContexts.length = 0;
}

describe("feedback reaction handler", () => {
  it("registers as a reactionAdd handler", () => {
    expect(feedback.type).toBe("reactionAdd");
  });

  it("ignores reactions to messages that are not indexed turn replies", async () => {
    clearCaptures();
    const handler = createFeedbackHandler(new TurnMessageStore(createMemoryRedis()));
    await handler.handle(reactionPacket("\u{1F44D}"));
    expect(Sentry.metrics.count).not.toHaveBeenCalled();
    expect(emitted).not.toHaveBeenCalled();
  });

  it("ignores reactions added by bots", async () => {
    clearCaptures();
    const handler = createFeedbackHandler(await indexedStore());
    const packet = reactionPacket("\u{1F44D}");
    packet.data.creator = { ...packet.data.creator, bot: true };
    await handler.handle(packet);
    expect(Sentry.metrics.count).not.toHaveBeenCalled();
    expect(emitted).not.toHaveBeenCalled();
  });

  it.each([
    ["\u{1F44D}", "true"],
    ["❤️", "true"],
    ["\u{1F525}", "true"],
    ["\u{1F4AF}", "true"],
    ["✅", "true"],
    ["\u{1F44E}", "false"],
    ["❌", "false"],
    ["\u{1F914}", "unknown"],
    ["custom_blob", "unknown"],
  ])("counts ai.feedback for %s with positive=%s", async (emoji, positive) => {
    clearCaptures();
    const handler = createFeedbackHandler(await indexedStore());
    await handler.handle(reactionPacket(emoji));
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.feedback", 1, {
      attributes: { emoji, positive },
    });
  });

  it("emits an ai.feedback wide event joining the reaction to the turn", async () => {
    clearCaptures();
    const handler = createFeedbackHandler(await indexedStore());
    await handler.handle(reactionPacket("❌"));
    expect(loggerContexts).toContainEqual({ op: "ai.feedback" });
    expect(emitted).toHaveBeenCalledWith({
      message_id: "msg-1",
      emoji: "❌",
      positive: "false",
      user_id: "user-1",
      chat_id: "wf-run-1",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      domains: ["linear"],
    });
  });
});
