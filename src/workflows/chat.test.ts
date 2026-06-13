import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SerializedAgentContext, StreamTurnResult, TurnUsage } from "@/lib/ai/types";
import type { RedisClient } from "@/lib/redis/client";
import type { MockDiscord } from "@/lib/test/types";

import type { ChatHookEvent, ChatPayload } from "./types";

import { asAPI, createMemoryRedis, createMockAPI } from "../lib/test/fixtures";

const h = vi.hoisted(() => {
  /** Stands in for WDK's FatalError; chat.ts only uses it for instanceof. */
  class FatalError extends Error {}
  return {
    FatalError,
    streamTurn: vi.fn(),
    generateText: vi.fn(),
    releaseSession: vi.fn(),
    emits: [] as Record<string, unknown>[],
    /** Per-call deep copies of the history streamTurn received — the workflow mutates the live array afterwards. */
    messagesSeen: [] as { role: string; content: string }[][],
    /** Outcome queue consumed per call: a result to return or an Error to throw. Empty -> default result. */
    turnOutcomes: [] as unknown[],
    state: {
      sleep: (): Promise<void> => Promise.resolve(),
      hook: null as unknown,
    },
  };
});

vi.mock("workflow", () => ({
  FatalError: h.FatalError,
  getWorkflowMetadata: () => ({ workflowRunId: "run-1" }),
  sleep: () => h.state.sleep(),
  createHook: () => h.state.hook,
}));
vi.mock("ai", () => ({ generateText: h.generateText }));
vi.mock("@/lib/ai/streaming", () => ({ streamTurn: h.streamTurn }));
vi.mock("@/lib/sandbox/session", () => ({ releaseSession: h.releaseSession }));
vi.mock("@/lib/discord/client", () => ({ createDiscordAPI: () => asAPI(discord) }));
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: () => memory } }));
vi.mock("@/lib/logging/wide", () => ({
  createWideLogger: () => ({
    set: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    emit: (event: Record<string, unknown>) => h.emits.push(event),
  }),
}));

let memory: RedisClient;
let discord: MockDiscord;

const { __resetRedisForTests } = await import("@/lib/redis/client");
const { ConversationStore } = await import("@/bot/store");
const { ContextSnapshotStore } = await import("@/bot/context-snapshot");
const { chatWorkflow } = await import("./chat");

/**
 * Controllable stand-in for a WDK hook: an async-iterable queue the test
 * pushes `ChatHookEvent`s into. Pre-queued events are delivered in order,
 * one per loop iteration, exactly like buffered `resumeHook` payloads.
 */
function installHook(...events: ChatHookEvent[]) {
  const queue = [...events];
  const waiters: ((r: IteratorResult<ChatHookEvent>) => void)[] = [];
  h.state.hook = {
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<IteratorResult<ChatHookEvent>> => {
          const event = queue.shift();
          if (event) return Promise.resolve({ done: false, value: event });
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    },
    [Symbol.dispose]() {},
  };
  // Deliver like the real WDK hook: the OLDEST pending next() gets the event.
  return (event: ChatHookEvent) => {
    const waiter = waiters.shift();
    if (waiter) waiter({ done: false, value: event });
    else queue.push(event);
  };
}

const usage = (): TurnUsage => ({
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  subagentTokens: 0,
  toolCallCount: 0,
  stepCount: 1,
  toolNames: [],
});

const turnResult = (text: string): StreamTurnResult => ({
  text,
  usage: usage(),
  discordMessageId: "msg-1",
  model: "anthropic/claude-sonnet-4.6",
});

const context: SerializedAgentContext = {
  userId: "u-1",
  username: "rayhan",
  nickname: "Rayhan",
  channel: { id: "ch-1", name: "general" },
  date: "Thursday, June 11, 2026",
};

const payload = (overrides?: Partial<ChatPayload>): ChatPayload => ({
  channelId: "ch-1",
  content: "hello",
  context,
  ...overrides,
});

const messageEvent = (content: string): ChatHookEvent => ({ type: "message", content, context });

async function seedConversation(workflowRunId = "run-1") {
  await new ConversationStore().set({
    workflowRunId,
    channelId: "ch-1",
    startedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  memory = createMemoryRedis();
  __resetRedisForTests();
  discord = createMockAPI();
  h.emits.length = 0;
  h.messagesSeen.length = 0;
  h.turnOutcomes.length = 0;
  // Resolved sleeps make the idle race win whenever the hook queue is empty:
  // pre-queued events still win their iteration because next() settles first.
  h.state.sleep = () => Promise.resolve();
  h.streamTurn.mockImplementation(
    async (
      _discord: unknown,
      _channelId: unknown,
      messages: { role: string; content: string }[],
    ) => {
      h.messagesSeen.push(structuredClone(messages));
      const next = h.turnOutcomes.shift();
      if (next instanceof Error) throw next;
      return next ?? turnResult("hi there");
    },
  );
  h.generateText.mockResolvedValue({ text: "compact summary" });
  h.releaseSession.mockResolvedValue(undefined);
  installHook();
});

describe("chatWorkflow: graceful termination", () => {
  it("ends at the idle timeout, cleans up, and emits ended_by: idle_timeout", async () => {
    await seedConversation();

    await chatWorkflow(payload());

    expect(await new ConversationStore().get("ch-1")).toBeNull();
    expect(await new ContextSnapshotStore().get("ch-1")).toBeNull();
    expect(h.releaseSession).toHaveBeenCalledWith("ch-1");
    const terminal = h.emits.find((e) => "ended_by" in e);
    expect(terminal).toMatchObject({ outcome: "ok", ended_by: "idle_timeout", turn_count: 1 });
  });

  it("ends on a {type: done} hook event with ended_by: user", async () => {
    await seedConversation();
    installHook({ type: "done" });

    await chatWorkflow(payload());

    expect(await new ConversationStore().get("ch-1")).toBeNull();
    expect(h.releaseSession).toHaveBeenCalledWith("ch-1");
    const terminal = h.emits.find((e) => "ended_by" in e);
    expect(terminal).toMatchObject({ outcome: "ok", ended_by: "user" });
  });

  it("does not delete a successor run's keys or sandbox (stale-run cleanup)", async () => {
    await seedConversation("run-SUCCESSOR");
    installHook({ type: "done" });

    await chatWorkflow(payload());

    const stored = await new ConversationStore().get("ch-1");
    expect(stored?.workflowRunId).toBe("run-SUCCESSOR");
    expect(h.releaseSession).not.toHaveBeenCalled();
    expect(h.emits.some((e) => e.outcome === "skipped_stale")).toBe(true);
  });

  it("answers a follow-up that raced the conversation end instead of dropping it", async () => {
    await seedConversation();
    // The message lands in the hook buffer after the done event — the main
    // loop exits without consuming it; the post-cleanup drain must.
    installHook({ type: "done" }, messageEvent("one last thing"));

    await chatWorkflow(payload());

    expect(h.streamTurn).toHaveBeenCalledTimes(2);
    expect(h.messagesSeen[1].at(-1)).toEqual({ role: "user", content: "one last thing" });
    expect(await new ConversationStore().get("ch-1")).toBeNull();
    const terminal = h.emits.find((e) => "ended_by" in e);
    expect(terminal).toMatchObject({ outcome: "ok", ended_by: "user", turn_count: 2 });
  });

  it("answers a follow-up that raced the idle timeout (lands on the abandoned next())", async () => {
    await seedConversation();
    const push = installHook();
    // By the time cleanup's releaseSession runs, the loop has abandoned its
    // pending next() to the idle timer. The straggler resolves that same
    // armed promise — the drain must still receive it.
    h.releaseSession.mockImplementation(async () => {
      push(messageEvent("late after idle"));
    });

    await chatWorkflow(payload());

    expect(h.streamTurn).toHaveBeenCalledTimes(2);
    expect(h.messagesSeen[1].at(-1)).toEqual({ role: "user", content: "late after idle" });
    const terminal = h.emits.find((e) => "ended_by" in e);
    expect(terminal).toMatchObject({ outcome: "ok", ended_by: "idle_timeout", turn_count: 2 });
  });

  it("cleans up on the error path too", async () => {
    await seedConversation();
    // Hook iterator blows up -> loop dies -> finally must still clean up.
    h.state.hook = {
      [Symbol.asyncIterator]() {
        return { next: () => Promise.reject(new Error("hook gone")) };
      },
      [Symbol.dispose]() {},
    };

    await expect(chatWorkflow(payload())).rejects.toThrow("hook gone");

    expect(await new ConversationStore().get("ch-1")).toBeNull();
    expect(h.releaseSession).toHaveBeenCalledWith("ch-1");
    const terminal = h.emits.find((e) => "ended_by" in e);
    expect(terminal).toMatchObject({ outcome: "error", ended_by: "error" });
  });
});

describe("chatWorkflow: turn failures", () => {
  it("keeps listening after a FatalError turn and leaves no trace in history", async () => {
    await seedConversation();
    h.turnOutcomes.push(new h.FatalError("model died"), turnResult("recovered"));
    installHook(messageEvent("are you ok?"), { type: "done" });

    await chatWorkflow(payload());

    expect(h.streamTurn).toHaveBeenCalledTimes(2);
    // The failed first turn's user message was popped — the follow-up turn
    // starts from a clean history.
    expect(h.messagesSeen[1]).toEqual([{ role: "user", content: "are you ok?" }]);
    const terminal = h.emits.find((e) => "ended_by" in e);
    expect(terminal).toMatchObject({ outcome: "ok", ended_by: "user", turn_count: 1 });
  });

  it("notifies the user when the turn step dies before streaming", async () => {
    await seedConversation();
    h.turnOutcomes.push(new Error("pre-stream transient"));
    installHook({ type: "done" });

    await chatWorkflow(payload({ placeholderMessageId: "ph-1" }));

    const edits = discord.callsTo("channels.editMessage");
    expect(edits).toContainEqual([
      "ch-1",
      "ph-1",
      { content: "Something went wrong while answering — try again." },
    ]);
    // Workflow survived to process the done event and clean up.
    expect(await new ConversationStore().get("ch-1")).toBeNull();
  });
});

describe("chatWorkflow: history management", () => {
  it("truncates stored assistant turns to the cap with a [truncated] marker", async () => {
    await seedConversation();
    h.turnOutcomes.push(turnResult("a".repeat(5000)), turnResult("short"));
    installHook(messageEvent("more"), { type: "done" });

    await chatWorkflow(payload());

    const followupMessages = h.messagesSeen.at(-1)!;
    expect(followupMessages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const assistant = followupMessages[1];
    expect(assistant.content).toHaveLength(4000 + "\n[truncated]".length);
    expect(assistant.content.endsWith("\n[truncated]")).toBe(true);
  });

  it("replaces dropped history with one cheap-model summary at the cap", async () => {
    await seedConversation();
    installHook(...Array.from({ length: 26 }, (_, i) => messageEvent(`followup ${i + 1}`)), {
      type: "done",
    });

    await chatWorkflow(payload());

    expect(h.generateText).toHaveBeenCalled();
    const lastMessages = h.messagesSeen.at(-1)!;
    expect(lastMessages.length).toBeLessThanOrEqual(50);
    expect(lastMessages[0].role).toBe("user");
    expect(lastMessages[0].content).toMatch(/^\[Summary of \d+ earlier messages/);
    expect(lastMessages[0].content).toContain("compact summary");
  });

  it("falls back to plain dropping when the summary step fails", async () => {
    await seedConversation();
    h.generateText.mockRejectedValue(new Error("summary model down"));
    installHook(...Array.from({ length: 26 }, (_, i) => messageEvent(`followup ${i + 1}`)), {
      type: "done",
    });

    await chatWorkflow(payload());

    const lastMessages = h.messagesSeen.at(-1)!;
    expect(lastMessages.length).toBeLessThanOrEqual(50);
    expect(lastMessages[0].role).toBe("user");
    expect(lastMessages[0].content).not.toMatch(/^\[Summary/);
  });
});
