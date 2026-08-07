/**
 * Validated environment available to Eve reasoning and domain integrations.
 * The bot supervisor is a separate Vercel deployment under packages/supervisor.
 * This project therefore never receives its Discord or operational credentials;
 * authored reasoning and tool modules cannot read the bot token from process env.
 *
 * Integration credentials remain optional at process start so local discovery
 * works without production access. Each capability fails closed when its own
 * required configuration is absent. A bare model id routes through the Vercel
 * AI Gateway and authenticates with project OIDC.
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const secret = z.string().min(1);

export const env = createEnv({
  server: {
    /** Bearer the bot must present on every inbound channel route. */
    AGENT_INGRESS_SECRET: secret,
    /** Where to wake the bot for durable parked/render markers. */
    BOT_URL: z.string().url(),
    /** Bearer the agent presents to the bot. */
    BOT_INGRESS_SECRET: secret,

    /** Audit log, scheduled tasks, shopping cart. */
    TURSO_DATABASE_URL: z.string().min(1),
    TURSO_AUTH_TOKEN: secret.optional(),

    /** Render coordination, token budgets, tools, and schedules. */
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: secret,

    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
    SENTRY_RELEASE: z.string().min(1).optional(),

    /** Optional Phase-3/4 integration credentials; tools deny when absent. */
    EDGE_CONFIG: z.string().url().optional(),
    LINEAR_API_KEY: secret.optional(),
    NOTION_TOKEN: secret.optional(),
    GITHUB_APP_ID: secret.optional(),
    GITHUB_APP_PRIVATE_KEY: secret.optional(),
    GITHUB_APP_INSTALLATION_ID: secret.optional(),
    GITHUB_ORG: z.string().min(1).optional(),
    FIGMA_ACCESS_TOKEN: secret.optional(),
    FIGMA_TEAM_ID: z.string().min(1).optional(),
    HCB_ORG_SLUG: z.string().min(1).optional(),
    SERPAPI_API_KEY: secret.optional(),
    EXA_API_KEY: secret.optional(),
    PHACK_ASK_API_KEY: secret.optional(),
    PAYLOAD_CMS_API_KEY: secret.optional(),
    RESEND_API_KEY: secret.optional(),
    RESEND_WEBHOOK_SECRET: secret.optional(),
    HUNTER_API_KEY: secret.optional(),
    SENTRY_AUTH_TOKEN: secret.optional(),
    SENTRY_ORG: z.string().min(1).optional(),
    SENTRY_PROJECT: z.string().min(1).optional(),
    VERCEL_API_TOKEN: secret.optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "1",
});
