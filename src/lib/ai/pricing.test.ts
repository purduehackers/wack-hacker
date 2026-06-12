import { describe, expect, it } from "vitest";

import { ORCHESTRATOR_MODEL, SUBAGENT_MODEL } from "./constants.ts";
import { estimateCostUsd } from "./pricing.ts";

// The code domain's spec.model override (delegates.ts). Hardcoded here instead
// of importing delegates.ts, which instantiates SDK clients at import time.
const CODE_SUBAGENT_MODEL = "anthropic/claude-opus-4.7";

describe("estimateCostUsd", () => {
  it("prices a known model with no cached tokens", () => {
    // Sonnet: $3/M input + $15/M output.
    const cost = estimateCostUsd({
      model: "anthropic/claude-sonnet-4.6",
      inputTokens: 1_000_000,
      outputTokens: 200_000,
    });
    expect(cost).toBeCloseTo(3 + 3, 10);
  });

  it("discounts cache reads at the cached-input rate", () => {
    // 600k uncached * $3/M + 400k cached * $0.30/M + 200k out * $15/M.
    const cost = estimateCostUsd({
      model: "anthropic/claude-sonnet-4.6",
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cachedInputTokens: 400_000,
    });
    expect(cost).toBeCloseTo(1.8 + 0.12 + 3, 10);
  });

  it("treats omitted cachedInputTokens as zero", () => {
    const withZero = estimateCostUsd({
      model: SUBAGENT_MODEL,
      inputTokens: 50_000,
      outputTokens: 10_000,
      cachedInputTokens: 0,
    });
    const withOmitted = estimateCostUsd({
      model: SUBAGENT_MODEL,
      inputTokens: 50_000,
      outputTokens: 10_000,
    });
    expect(withOmitted).toBe(withZero);
  });

  it("clamps cachedInputTokens to inputTokens so cost never goes negative", () => {
    // Provider quirk guard: cached reads can never exceed the total prompt.
    const cost = estimateCostUsd({
      model: SUBAGENT_MODEL,
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 500,
    });
    expect(cost).toBeCloseTo((100 * 0.025) / 1_000_000, 12);
  });

  it("returns undefined for unknown models", () => {
    expect(
      estimateCostUsd({ model: "acme/unpriced-1", inputTokens: 1_000, outputTokens: 100 }),
    ).toBeUndefined();
  });

  it("covers every model slug the repo actually runs", () => {
    for (const model of [ORCHESTRATOR_MODEL, SUBAGENT_MODEL, CODE_SUBAGENT_MODEL]) {
      const cost = estimateCostUsd({ model, inputTokens: 1_000, outputTokens: 1_000 });
      expect(cost).toBeGreaterThan(0);
    }
  });

  it("prices the code-subagent Opus override well above the mini default", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const opus = estimateCostUsd({ model: CODE_SUBAGENT_MODEL, ...usage });
    const mini = estimateCostUsd({ model: SUBAGENT_MODEL, ...usage });
    expect(mini).toBeDefined();
    expect(opus).toBeGreaterThan((mini ?? 0) * 10);
  });
});
