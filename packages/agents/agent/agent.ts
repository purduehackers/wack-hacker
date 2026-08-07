import { defineAgent } from "eve";

const TWO_HOURS_MS = 2 * 60 * 60_000;

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  compaction: { thresholdPercent: 0.8 },
  limits: {
    sessionTimeoutMs: TWO_HOURS_MS,
    maxInputTokensPerSession: 500_000,
    maxOutputTokensPerSession: 50_000,
  },
});
