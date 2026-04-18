import { describe, it, expect } from "vitest";

import { TurnUsageTracker, addTurnUsage, emptyTurnUsage } from "./turn-usage.ts";

describe("TurnUsageTracker", () => {
  it("starts empty", () => {
    const t = new TurnUsageTracker();
    expect(t.toTurnUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
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

  it("coerces undefined orchestrator tokens to zero", () => {
    const t = new TurnUsageTracker();
    t.addSubagent({ tokens: 50, toolCalls: 1 });
    t.recordOrchestrator({
      usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      steps: [],
    });
    const usage = t.toTurnUsage();
    expect(usage.totalTokens).toBe(50);
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.toolCallCount).toBe(1);
    expect(usage.stepCount).toBe(0);
  });
});

describe("emptyTurnUsage", () => {
  it("returns a zeroed accumulator", () => {
    expect(emptyTurnUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      subagentTokens: 0,
      toolCallCount: 0,
      stepCount: 0,
    });
  });
});

describe("addTurnUsage", () => {
  it("sums every field across two turns", () => {
    const a = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      subagentTokens: 20,
      toolCallCount: 2,
      stepCount: 3,
    };
    const b = {
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
      subagentTokens: 10,
      toolCallCount: 1,
      stepCount: 2,
    };
    expect(addTurnUsage(a, b)).toEqual({
      inputTokens: 300,
      outputTokens: 130,
      totalTokens: 430,
      subagentTokens: 30,
      toolCallCount: 3,
      stepCount: 5,
    });
  });

  it("adds onto emptyTurnUsage cleanly", () => {
    const b = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      subagentTokens: 2,
      toolCallCount: 1,
      stepCount: 1,
    };
    expect(addTurnUsage(emptyTurnUsage(), b)).toEqual(b);
  });
});
