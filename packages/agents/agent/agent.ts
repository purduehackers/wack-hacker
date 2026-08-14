import { defineAgent } from "eve";

const TWO_HOURS_MS = 2 * 60 * 60_000;

export default defineAgent({
  model: "deepseek/deepseek-v4-flash-0731",
  modelOptions: {
    providerOptions: {
      // DeepSeek caches implicitly; `auto` also covers a gateway fallback to a
      // provider that needs explicit cache_control breakpoints.
      gateway: { caching: "auto" },
    },
  },
  compaction: { thresholdPercent: 0.8 },
  // No token limits: Eve's own defaults are more generous than anything worth
  // hand-picking here — 40M provider-reported input tokens for a root session,
  // and output uncapped unless configured. The previous 500k input cap was 80x
  // below the framework default, and because a delegated child receives a share
  // of its parent's *remaining* quota rather than a default of its own, that cap
  // was also every subagent's ceiling. Only the wall-clock bound stays.
  limits: {
    sessionTimeoutMs: TWO_HOURS_MS,
  },
});
