import { describe, it, expect, vi } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures";

import type { ContextSnapshot } from "./context-snapshot";

import { ContextSnapshotStore } from "./context-snapshot";

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => createMemoryRedis() },
}));

const sampleSnapshot: ContextSnapshot = {
  model: "anthropic/claude-sonnet-4.6",
  context: {
    userId: "u-1",
    username: "rayhan",
    nickname: "Rayhan",
    channel: { id: "ch-1", name: "bot-testing" },
    date: "Wednesday, April 15, 2026",
  },
  systemPrompt: "You are a helpful assistant...",
  tools: [{ name: "currentTime", description: "Get the current time.", inputSchema: {} }],
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ],
  lastTurnUsage: {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    subagentTokens: 0,
    toolCallCount: 1,
    stepCount: 2,
  },
  turnCount: 1,
  updatedAt: "2026-04-15T12:00:00.000Z",
};

describe("ContextSnapshotStore", () => {
  it("sets and gets a snapshot keyed by channel only", async () => {
    const store = new ContextSnapshotStore(createMemoryRedis());
    await store.set("ch-1", undefined, sampleSnapshot);
    const out = await store.get("ch-1");
    expect(out?.model).toBe("anthropic/claude-sonnet-4.6");
    expect(out?.messages).toHaveLength(2);
  });

  it("uses threadId as the key when provided", async () => {
    const store = new ContextSnapshotStore(createMemoryRedis());
    await store.set("ch-1", "thread-9", sampleSnapshot);
    expect(await store.get("ch-1", "thread-9")).not.toBeNull();
    expect(await store.get("ch-1")).toBeNull();
  });

  it("returns null for missing snapshot", async () => {
    const store = new ContextSnapshotStore(createMemoryRedis());
    expect(await store.get("nope")).toBeNull();
  });

  it("deletes a snapshot", async () => {
    const store = new ContextSnapshotStore(createMemoryRedis());
    await store.set("ch-1", undefined, sampleSnapshot);
    await store.delete("ch-1");
    expect(await store.get("ch-1")).toBeNull();
  });

  it("uses Redis.fromEnv when no redis argument is provided", async () => {
    const defaultStore = new ContextSnapshotStore();
    expect(await defaultStore.get("nonexistent")).toBeNull();
  });
});
