import { describe, it, expect } from "vitest";

import { TurnUsageTracker } from "./turn-usage.ts";

describe("TurnUsageTracker", () => {
  it("starts empty", () => {
    const t = new TurnUsageTracker();
    expect(t.toTurnUsage()).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: 0,
      subagentTokens: 0,
      toolCallCount: 0,
      stepCount: 0,
    });
  });

  it("accumulates subagent contributions across calls", () => {
    const t = new TurnUsageTracker();
    t.addSubagent({ tokens: 100, toolCalls: 2 });
    t.addSubagent({ tokens: 250, toolCalls: 3 });
    expect(t.toTurnUsage()).toMatchObject({
      subagentTokens: 350,
      toolCallCount: 5,
    });
  });

  it("merges orchestrator usage with subagent totals", () => {
    const t = new TurnUsageTracker();
    t.addSubagent({ tokens: 200, toolCalls: 4 });
    t.recordOrchestrator({
      usage: { inputTokens: 800, outputTokens: 150, totalTokens: 950 },
      steps: [{ toolCalls: [1, 2] }, { toolCalls: [3] }],
    });
    const usage = t.toTurnUsage();
    expect(usage).toEqual({
      inputTokens: 800,
      outputTokens: 150,
      totalTokens: 1150,
      subagentTokens: 200,
      toolCallCount: 7,
      stepCount: 2,
    });
  });

  it("exposes convenience accessors after recordOrchestrator", () => {
    const t = new TurnUsageTracker();
    t.addSubagent({ tokens: 50, toolCalls: 1 });
    t.recordOrchestrator({
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      steps: [{ toolCalls: [1, 2, 3] }],
    });
    expect(t.totalTokens).toBe(200);
    expect(t.totalToolCalls).toBe(4);
    expect(t.totalSteps).toBe(1);
  });

  it("handles missing orchestrator totalTokens", () => {
    const t = new TurnUsageTracker();
    t.addSubagent({ tokens: 50, toolCalls: 1 });
    t.recordOrchestrator({
      usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      steps: [],
    });
    const usage = t.toTurnUsage();
    expect(usage.totalTokens).toBe(50);
    expect(usage.inputTokens).toBeUndefined();
    expect(usage.outputTokens).toBeUndefined();
    expect(usage.toolCallCount).toBe(1);
    expect(usage.stepCount).toBe(0);
  });
});
