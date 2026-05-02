import { createEnv } from "@t3-oss/env-core";
import { vercel } from "@t3-oss/env-core/presets-zod";
import { z } from "zod";

export const env = createEnv({
  server: {
    DISCORD_BOT_TOKEN: z.string(),
    DISCORD_BOT_CLIENT_ID: z.string(),
    DISCORD_BOT_PUBLIC_KEY: z.string(),
    CRON_SECRET: z.string(),
    LINEAR_API_KEY: z.string(),
    NOTION_TOKEN: z.string(),
    GITHUB_APP_ID: z.string(),
    GITHUB_APP_PRIVATE_KEY: z.string(),
    GITHUB_APP_INSTALLATION_ID: z.string(),
    GITHUB_ORG: z.string(),
    FIGMA_ACCESS_TOKEN: z.string(),
    FIGMA_TEAM_ID: z.string(),
    PHACK_ASK_API_KEY: z.string(),
    GROQ_API_KEY: z.string(),
    PHACK_API_TOKEN: z.string(),
    PRIVACY_DB_API_KEY: z.string(),
    SHIP_API_KEY: z.string(),
    TURSO_DATABASE_URL: z.string(),
    TURSO_AUTH_TOKEN: z.string(),
    KV_REST_API_URL: z.string(),
    KV_REST_API_TOKEN: z.string(),
    VERCEL_API_TOKEN: z.string(),
    DASHBOARD_EDGE_CONFIG: z.string(),
    EDGE_CONFIG: z.string(),
    SENTRY_AUTH_TOKEN: z.string(),
    SENTRY_ORG: z.string(),
    SENTRY_DSN: z.string().optional(),
    HCB_ORG_SLUG: z.string(),
    SERPAPI_API_KEY: z.string(),
    EXA_API_KEY: z.string(),
    RESEND_API_KEY: z.string(),
    RESEND_WEBHOOK_SECRET: z.string(),
    HUNTER_API_KEY: z.string(),
    PAYLOAD_CMS_API_KEY: z.string(),
    // Genuinely optional: when set, sandbox sessions boot from this prebuilt
    // snapshot (ripgrep + gh preinstalled) and skip ~20-30s of dnf install. The
    // app runs fine without it. Create one via scripts/create-sandbox-snapshot.ts.
    SANDBOX_BASE_SNAPSHOT_ID: z.string().optional(),
  },
  extends: [vercel()],
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
