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
  // `automaticVercelMonitors` is intentionally omitted: it reads a `vercel.json`
  // crons block that doesn't exist here (crons run via Hono routes, not Vercel
  // Cron), and it's Pages-Router-only. Cron check-ins are wired explicitly with
  // `Sentry.withMonitor` at the dispatch chokepoint instead.
});
