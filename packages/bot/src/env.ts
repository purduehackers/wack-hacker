/**
 * Validated environment for the bot process.
 *
 * This schema deliberately declares only what the bot *currently uses*. Adding
 * a variable before the code that reads it lands would either block local
 * development (if required) or turn a missing credential into a runtime failure
 * deep inside a handler (if optional). Variables arrive alongside the feature
 * that needs them; `.env.example` at the repo root documents the full set with
 * the phase each belongs to.
 *
 * Note what is *not* here: Turso. The bot writes no durable rows — the audit
 * log, scheduled tasks, and the shopping cart are all agent-side — and its own
 * state (dedup keys, per-key locks, the pending-turn queue, hack-night thread
 * mapping) is short-lived and lives in Redis. Giving the bot database
 * credentials it does not need would be a needless blast radius.
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const secret = z.string().min(1);

export const env = createEnv({
  server: {
    /** Gateway login and every outbound Discord REST call. */
    DISCORD_BOT_TOKEN: secret,
    /** Application id, used to register slash commands at startup. */
    DISCORD_BOT_CLIENT_ID: secret,

    /** Base URL of the eve deployment. No trailing slash. */
    AGENT_URL: z.string().url(),
    /** Bearer the bot presents to the agent. */
    AGENT_INGRESS_SECRET: secret,
    /** Bearer the agent must present on the parked callback. */
    BOT_INGRESS_SECRET: secret,

    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: secret,

    /**
     * Health server port. The Vercel Sandbox supervisor polls it, and Fly or a
     * homelab host uses it as a liveness probe — the same endpoint serves both.
     */
    PORT: z.coerce.number().int().positive().default(8080),

    /** `/privacy`, backed by pdb.purduehackers.com. */
    PRIVACY_DB_API_KEY: secret,

    /** `/hack-night` bumps the dashboard's Edge Config `version` key. */
    VERCEL_API_TOKEN: secret,
    DASHBOARD_EDGE_CONFIG: secret,

    /** The hack night photo archive in Payload CMS. */
    PAYLOAD_CMS_API_KEY: secret,

    SENTRY_DSN: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  /**
   * An unset variable and one set to "" should behave identically; otherwise a
   * blank line in a .env file silently satisfies a required secret.
   */
  emptyStringAsUndefined: true,
  /** Escape hatch for tooling that loads the module without credentials. */
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "1",
});
