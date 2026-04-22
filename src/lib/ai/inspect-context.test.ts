import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import type { ContextSnapshot } from "@/bot/context-snapshot";

import { mockFetch } from "@/lib/test/fixtures";

import type { ModelInfo } from "./models-dev.ts";

const { breakdownFromSnapshot, estimateTokens } = await import("./inspect-context.ts");

// `fetchModelInfo` hits https://models.dev/api.json via global fetch. Stub it
// to an empty catalog by default; individual tests override via `fetchInfo`
// injected into `breakdownFromSnapshot`.
let restoreFetch: () => void;

beforeEach(() => {
  ({ restore: restoreFetch } = mockFetch(() => new Response(JSON.stringify({}), { status: 200 })));
});

afterEach(() => {
  restoreFetch();
});

const baseSnap: ContextSnapshot = {
  model: "anthropic/claude-sonnet-4.6",
  context: {
    userId: "u-1",
    username: "rayhan",
    nickname: "Rayhan",
    channel: { id: "ch-1", name: "bot-testing" },
    date: "Wednesday, April 15, 2026",
  },
  // 120 chars → 30 estimated tokens
  systemPrompt: "a".repeat(120),
  // JSON.stringify returns 2 chars → 1 token
  tools: [],
  // "user: hi" = 8 chars → 2 tokens
  messages: [{ role: "user", content: "hi" }],
  totalUsage: {
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    subagentTokens: 0,
    toolCallCount: 1,
    stepCount: 2,
  },
  turnCount: 1,
  updatedAt: "2026-04-15T12:00:00.000Z",
};

const modelInfo: ModelInfo = {
  id: "claude-sonnet-4-6-20260301",
  provider: "anthropic",
  limit: { context: 200_000, output: 64_000 },
  cost: { input: 3, output: 15 },
};

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("aaaa")).toBe(1);
    expect(estimateTokens("aaaaa")).toBe(2);
  });
});

describe("breakdownFromSnapshot", () => {
  it("builds categories and sums estimated input tokens", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const out = await breakdownFromSnapshot(baseSnap, fetchInfo);
    expect(fetchInfo).toHaveBeenCalledWith("anthropic/claude-sonnet-4.6");
    expect(out.categories.map((c) => c.label)).toEqual([
      "System prompt",
      "Tools",
      "Delegate agents",
      "Conversation history",
    ]);
    const system = out.categories.find((c) => c.label === "System prompt");
    const history = out.categories.find((c) => c.label === "Conversation history");
    expect(system?.estimatedTokens).toBe(30);
    expect(history?.estimatedTokens).toBe(2);
    expect(out.estimatedInputTokens).toBe(
      out.categories.reduce((sum, c) => sum + c.estimatedTokens, 0),
    );
  });

  it("computes last-turn cost from real usage × pricing", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const out = await breakdownFromSnapshot(baseSnap, fetchInfo);
    // 1000 input * $3/M = $0.003, 200 output * $15/M = $0.003, total = $0.006
    expect(out.totalCostUsd?.input).toBeCloseTo(0.003, 6);
    expect(out.totalCostUsd?.output).toBeCloseTo(0.003, 6);
    expect(out.totalCostUsd?.total).toBeCloseTo(0.006, 6);
  });

  it("omits cost when modelInfo is null", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(null);
    const out = await breakdownFromSnapshot(baseSnap, fetchInfo);
    expect(out.modelInfo).toBeNull();
    expect(out.totalCostUsd).toBeUndefined();
  });

  it("returns zero cost when both token counts are zero", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      totalUsage: {
        ...baseSnap.totalUsage,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    expect(out.totalCostUsd?.input).toBe(0);
    expect(out.totalCostUsd?.output).toBe(0);
    expect(out.totalCostUsd?.total).toBe(0);
  });

  it("computes cost with only input tokens present", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      totalUsage: { ...baseSnap.totalUsage, outputTokens: 0 },
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    expect(out.totalCostUsd?.output).toBe(0);
    expect(out.totalCostUsd?.input).toBeCloseTo(0.003, 6);
  });

  it("computes cost with only output tokens present", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      totalUsage: { ...baseSnap.totalUsage, inputTokens: 0 },
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    expect(out.totalCostUsd?.input).toBe(0);
    expect(out.totalCostUsd?.output).toBeCloseTo(0.003, 6);
  });

  it("uses the default fetchModelInfo when no fetchInfo is passed", async () => {
    const out = await breakdownFromSnapshot(baseSnap);
    // Mocked default returns null → no model metadata in the breakdown.
    expect(out.modelInfo).toBeNull();
    expect(out.totalCostUsd).toBeUndefined();
  });

  it("forwards turnCount and messageCount", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      turnCount: 5,
      messages: [
        { role: "user" as const, content: "a" },
        { role: "assistant" as const, content: "b" },
        { role: "user" as const, content: "c" },
      ],
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    expect(out.turnCount).toBe(5);
    expect(out.messageCount).toBe(3);
  });
});

describe("breakdownFromSnapshot — tool partitioning", () => {
  it("partitions tools into base tools and delegate agents by name prefix", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      tools: [
        { name: "current_time", description: "time", inputSchema: {} },
        { name: "documentation", description: "docs", inputSchema: {} },
        { name: "delegate_linear", description: "linear", inputSchema: {} },
        { name: "delegate_github", description: "github", inputSchema: {} },
      ],
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    const tools = out.categories.find((c) => c.label === "Tools");
    const delegates = out.categories.find((c) => c.label === "Delegate agents");
    expect(tools?.items?.map((i) => i.name)).toEqual(["current_time", "documentation"]);
    expect(delegates?.items?.map((i) => i.name)).toEqual(["delegate_linear", "delegate_github"]);
    for (const item of [...(tools?.items ?? []), ...(delegates?.items ?? [])]) {
      expect(item.estimatedTokens).toBeGreaterThan(0);
    }
  });
});

describe("breakdownFromSnapshot — delegate subskills", () => {
  it("attaches no skills to delegates for a Public-tier user", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      tools: [{ name: "delegate_linear", description: "linear", inputSchema: {} }],
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    const delegates = out.categories.find((c) => c.label === "Delegate agents");
    expect(delegates?.items?.[0].skills).toBeUndefined();
  });

  it("attaches Organizer-tier subskills to each delegate with a known domain", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      context: { ...baseSnap.context, memberRoles: ["1012751663322382438"] },
      tools: [
        { name: "delegate_linear", description: "linear", inputSchema: {} },
        { name: "delegate_github", description: "github", inputSchema: {} },
      ],
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    const delegates = out.categories.find((c) => c.label === "Delegate agents");
    const linear = delegates?.items?.find((i) => i.name === "delegate_linear");
    const github = delegates?.items?.find((i) => i.name === "delegate_github");
    expect(linear?.skills?.length).toBeGreaterThan(0);
    expect(github?.skills?.length).toBeGreaterThan(0);
    for (const s of linear?.skills ?? []) {
      expect(s.estimatedTokens).toBeGreaterThan(0);
    }
  });

  it("returns undefined skills for a delegate whose domain is not registered", async () => {
    const fetchInfo = vi.fn().mockResolvedValue(modelInfo);
    const snap = {
      ...baseSnap,
      context: { ...baseSnap.context, memberRoles: ["1012751663322382438"] },
      tools: [{ name: "delegate_unknown", description: "?", inputSchema: {} }],
    };
    const out = await breakdownFromSnapshot(snap, fetchInfo);
    const delegates = out.categories.find((c) => c.label === "Delegate agents");
    expect(delegates?.items?.[0].skills).toBeUndefined();
  });
});
