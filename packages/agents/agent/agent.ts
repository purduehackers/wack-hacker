import { defineAgent } from "eve";

const TWO_HOURS_MS = 2 * 60 * 60_000;

export default defineAgent({
  /**
   * The Codex harness adapter loads its sandbox bridge from files on disk
   * (`dist/bridge/*`) resolved against `import.meta.url`. Nitro inlines the
   * adapter into `_libs/` and does not carry those assets, so the bridge is
   * missing at runtime in hosted output. Keeping these external ships them via
   * `server/node_modules` with their package layout intact.
   */
  build: {
    externalDependencies: ["@ai-sdk/harness", "@ai-sdk/harness-codex", "@ai-sdk/sandbox-vercel"],
  },
  model: "deepseek/deepseek-v4-flash-0731",
  modelOptions: {
    providerOptions: {
      // DeepSeek caches implicitly; `auto` also covers a gateway fallback to a
      // provider that needs explicit cache_control breakpoints.
      gateway: { caching: "auto" },
    },
  },
  compaction: { thresholdPercent: 0.8 },
  limits: {
    sessionTimeoutMs: TWO_HOURS_MS,
    /**
     * The root budget is also every subagent's budget.
     *
     * A delegated child has no default of its own — Eve gives it a share of the
     * parent's *remaining* quota, split across the batch. At 500k a root that
     * had already done some work handed each child roughly 200k, which is a
     * small context for a domain agent holding 68 tools and a skill document.
     * Eve's own default for a root session is 40M; this stays well under that
     * while leaving a child over a million tokens even after a busy parent turn
     * and a parallel dispatch.
     */
    maxInputTokensPerSession: 10_000_000,
    /** Raised with the input budget: 50k of output cannot fill a 10M session. */
    maxOutputTokensPerSession: 1_000_000,
  },
});
