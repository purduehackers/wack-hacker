import { defineAgent } from "eve";

export default defineAgent({
  build: {
    externalDependencies: ["@resvg/resvg-js", "@repo/badge-renderer", "@sparticuz/chromium"],
  },
  model: "deepseek/deepseek-v4-flash-0731",
  compaction: { thresholdPercent: 0.8 },
  limits: { sessionTimeoutMs: 2 * 60 * 60_000 },
});
