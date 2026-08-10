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

/**
 * A credential, presented verbatim.
 *
 * Deliberately *not* trimmed, matching `packages/agents/agent/env.ts`.
 * `AGENT_INGRESS_SECRET` and `BOT_INGRESS_SECRET` are compared byte for byte by
 * `bearerMatches`, and the agent's Sandbox supervisor injects the *same raw
 * string* into this process that the agent itself holds. Trimming on one side
 * only would turn a value with stray whitespace — which both sides previously
 * agreed on — into a 401 on every request in both directions.
 */
const secret = z.string().min(1);

/**
 * A decimal port, parsed rather than coerced.
 *
 * `z.coerce.number()` runs `Number()`, which happily accepts `" 8080 "`, `0x1F`
 * and `1e3`. Requiring the digits first means the value in the environment is
 * the value the process binds.
 */
const port = z
  .string()
  .regex(z.regexes.integer)
  .transform((value) => Number.parseInt(value, 10))
  .pipe(z.int().positive());

export const env = createEnv({
  server: {
    /** Gateway login and every outbound Discord REST call. */
    DISCORD_BOT_TOKEN: secret,
    /** Application id, used to register slash commands at startup. */
    DISCORD_BOT_CLIENT_ID: secret,

    /** Base URL of the eve deployment. No trailing slash. */
    AGENT_URL: z.url({ protocol: /^https?$/u }),
    /** Bearer the bot presents to the agent. */
    AGENT_INGRESS_SECRET: secret,
    /** Bearer the agent must present on the parked callback. */
    BOT_INGRESS_SECRET: secret,

    UPSTASH_REDIS_REST_URL: z.url({ protocol: /^https?$/u }),
    UPSTASH_REDIS_REST_TOKEN: secret,

    /**
     * Health server port. The Vercel Sandbox supervisor polls it, and Fly or a
     * homelab host uses it as a liveness probe — the same endpoint serves both.
     */
    PORT: port.default(8080),

    /** `/hack-night` bumps the dashboard's Edge Config `version` key. */
    VERCEL_API_TOKEN: secret,
    DASHBOARD_EDGE_CONFIG: secret,

    /** The hack night photo archive in Payload CMS. */
    PAYLOAD_CMS_API_KEY: secret,

    /** Mirroring #ship posts to ships.purduehackers.com. */
    SHIP_API_KEY: secret,

    /** Mirroring public messages to the dashboard at api.purduehackers.com. */
    PHACK_API_TOKEN: secret,

    /** Voice-message transcription via Groq whisper-large-v3-turbo. */
    GROQ_API_KEY: secret,

    SENTRY_DSN: z.url({ protocol: /^https?$/u }).optional(),
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
