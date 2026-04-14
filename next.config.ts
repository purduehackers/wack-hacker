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
  webpack: {
    automaticVercelMonitors: true,
  },
});
