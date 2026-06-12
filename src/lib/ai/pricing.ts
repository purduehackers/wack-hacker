interface ModelPricing {
  /** USD per million uncached input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** USD per million cache-read input tokens. */
  cachedInputPerMTok: number;
}

/**
 * Static list prices by AI-gateway model slug, per Anthropic/OpenAI published
 * API pricing as of June 2026. Covers every slug this repo actually runs
 * (`ORCHESTRATOR_MODEL`, `SUBAGENT_MODEL`, and the code domain's Opus
 * override). Order of magnitude matters more than cent-accuracy here — this
 * feeds cost-attribution metrics, not billing.
 */
const PRICE_TABLE: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4.6": { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
  "anthropic/claude-opus-4.7": { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5 },
  "openai/gpt-5.4-mini": { inputPerMTok: 0.25, outputPerMTok: 2, cachedInputPerMTok: 0.025 },
};

/**
 * Estimate the USD cost of one model invocation (or an aggregate of them).
 * Returns `undefined` for models missing from the price table — callers skip
 * the cost metric and count `ai.cost.unknown_model` instead of emitting a
 * misleading figure.
 *
 * The AI SDK's `inputTokens` is the TOTAL prompt (cache reads included), so
 * cached tokens are subtracted out and re-priced at the cache-read rate.
 */
export function estimateCostUsd(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number | undefined {
  const price = PRICE_TABLE[args.model];
  if (!price) return undefined;
  const cached = Math.min(args.cachedInputTokens ?? 0, args.inputTokens);
  const uncached = args.inputTokens - cached;
  return (
    (uncached * price.inputPerMTok +
      cached * price.cachedInputPerMTok +
      args.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}
