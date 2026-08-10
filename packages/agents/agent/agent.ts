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
    maxInputTokensPerSession: 500_000,
    maxOutputTokensPerSession: 50_000,
  },
});
