import { describe, it, expect } from "vitest";

import type { ContextBreakdown } from "@/lib/ai/inspect-context";

import { renderContextReport } from "./render";

const modelInfo = {
  id: "claude-sonnet-4-6-20260301",
  provider: "anthropic",
  limit: { context: 200_000, output: 64_000 },
  cost: { input: 3, output: 15 },
};

const baseBreakdown: ContextBreakdown = {
  model: "anthropic/claude-sonnet-4.6",
  modelInfo,
  categories: [
    { label: "System prompt", chars: 4000, estimatedTokens: 1000 },
    { label: "Tools", chars: 12_000, estimatedTokens: 3000 },
    { label: "Conversation history", chars: 24_000, estimatedTokens: 6000 },
  ],
  estimatedInputTokens: 10_000,
  lastTurnUsage: {
    inputTokens: 12_482,
    outputTokens: 543,
    totalTokens: 13_025,
    subagentTokens: 0,
    toolCallCount: 2,
    stepCount: 3,
  },
  turnCount: 14,
  messageCount: 38,
  lastTurnCostUsd: { input: 0.037446, output: 0.008145, total: 0.045591 },
};

describe("renderContextReport", () => {
  it("includes the model id and exchange count header", () => {
    const out = renderContextReport(baseBreakdown);
    expect(out).toContain("after 14 exchanges");
    expect(out).toContain("anthropic/claude-sonnet-4.6");
    expect(out).toContain("claude-sonnet-4-6-20260301");
  });

  it("singularizes the exchange count when there is only one", () => {
    const out = renderContextReport({ ...baseBreakdown, turnCount: 1 });
    expect(out).toContain("after 1 exchange");
    expect(out).not.toContain("1 exchanges");
  });

  it("shows context window and per-category lines", () => {
    const out = renderContextReport(baseBreakdown);
    expect(out).toContain("200,000 tokens");
    expect(out).toContain("**System prompt**");
    expect(out).toContain("**Tools**");
    expect(out).toContain("**Conversation history**");
    expect(out).toContain("38 messages");
  });

  it("includes last-turn usage and cost when available", () => {
    const out = renderContextReport(baseBreakdown);
    expect(out).toContain("input 12,482");
    expect(out).toContain("output 543");
    expect(out).toContain("tools 2");
    expect(out).toContain("steps 3");
    expect(out).toContain("$0.0456");
  });

  it("omits cost line when modelInfo is null", () => {
    const out = renderContextReport({
      ...baseBreakdown,
      modelInfo: null,
      lastTurnCostUsd: undefined,
    });
    expect(out).toContain("unknown (model not in models.dev catalog)");
    expect(out).not.toContain("Last turn cost");
  });

  it("omits free-space line when modelInfo is null", () => {
    const out = renderContextReport({
      ...baseBreakdown,
      modelInfo: null,
      lastTurnCostUsd: undefined,
    });
    expect(out).not.toContain("Free space");
  });

  it("includes subagent tokens when present", () => {
    const out = renderContextReport({
      ...baseBreakdown,
      lastTurnUsage: { ...baseBreakdown.lastTurnUsage, subagentTokens: 800 },
    });
    expect(out).toContain("subagents 800");
  });

  it("stays under Discord's 2000 char limit", () => {
    const out = renderContextReport(baseBreakdown);
    expect(out.length).toBeLessThan(2000);
  });
});
