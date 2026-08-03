/**
 * Validated environment for the eve agent.
 *
 * As with the bot, this declares only what is currently wired. The twelve
 * domain integrations (Linear, GitHub, Notion, Figma, Sentry, Vercel, Payload,
 * HCB, SerpAPI, Resend, Hunter, Exa) each arrive with their subagent in Phase 4,
 * and their credentials arrive with them. `.env.example` at the repo root
 * documents the full set now so nothing is a surprise later — the legacy app's
 * .env.example had drifted eight variables behind its own schema.
 *
 * The model credential is absent on purpose: a bare string model id routes
 * through the Vercel AI Gateway and authenticates with project OIDC, which
 * Vercel injects as `VERCEL_OIDC_TOKEN`. `eve link` pulls it into `.env.local`
 * for local development. Declaring it here would imply we manage it.
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const secret = z.string().min(1);

export const env = createEnv({
  server: {
    /**
     * The paint layer posts, edits, and splits messages itself rather than using
     * eve's built-in Discord channel, so the agent needs the bot token too.
     */
    DISCORD_BOT_TOKEN: secret,

    /** Bearer the bot must present on every inbound channel route. */
    AGENT_INGRESS_SECRET: secret,
    /** Where to send the parked callback so the bot can drain its queue. */
    BOT_URL: z.string().url(),
    /** Bearer the agent presents to the bot. */
    BOT_INGRESS_SECRET: secret,

    /** Audit log, scheduled tasks, shopping cart. */
    TURSO_DATABASE_URL: z.string().min(1),
    TURSO_AUTH_TOKEN: secret.optional(),

    /** Daily token budgets and the turn→message index used by feedback. */
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: secret,

    SENTRY_DSN: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "1",
});
