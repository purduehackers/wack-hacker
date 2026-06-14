import type { NextConfig } from "next";

import { withSentryConfig } from "@sentry/nextjs";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["discord.js", "@libsql/client"],
};

export default withSentryConfig(withWorkflow(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Tie issues/logs/source maps to the deploy. Setting the release name once
  // here drives both the source-map upload AND the runtime SDK (via the build
  // constant the plugin injects), so the two can't drift. Guarded so local
  // builds fall back to the plugin's git auto-detection.
  ...(process.env.VERCEL_GIT_COMMIT_SHA
    ? { release: { name: process.env.VERCEL_GIT_COMMIT_SHA } }
    : {}),
  // `automaticVercelMonitors` is intentionally omitted: it reads a `vercel.json`
  // crons block that doesn't exist here (crons run via Hono routes, not Vercel
  // Cron), and it's Pages-Router-only. Cron check-ins are wired explicitly with
  // `Sentry.withMonitor` at the dispatch chokepoint instead.
});
