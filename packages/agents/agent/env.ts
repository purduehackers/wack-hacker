/**
 * Validated environment for the agent deployment.
 *
 * Integration credentials remain optional at process start so local discovery
 * works without production access. Each capability fails closed when its own
 * required configuration is absent. A bare model id routes through the Vercel
 * AI Gateway and authenticates with project OIDC.
 *
 * The bot-container block at the bottom is different in kind from everything
 * above it. Those values are not read by reasoning or by any tool: they exist
 * only for injection into the Sandbox that `agent/schedules/bot-supervisor.ts`
 * starts. Keeping them optional here and required in
 * `bot/supervisor-config.ts` is what lets this deployment run normally with
 * supervision switched off.
 */

import type { TursoConfig } from "@repo/shared/db";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const secret = z.string().min(1);
/** Identifiers pasted into a dashboard pick up stray whitespace. Slugs never contain it. */
const identifier = z.string().trim().min(1);
/** Every URL below addresses an HTTP endpoint. A non-HTTP scheme is a misconfiguration. */
const httpUrl = z.url({ protocol: /^https?$/u });
/** Decimal string in, unit fraction out — unlike `z.coerce.number`, which accepts `" 0x10 "`. */
const unitFraction = z.codec(z.string().regex(z.regexes.number), z.number().min(0).max(1), {
  decode: (value) => Number.parseFloat(value),
  encode: (value) => value.toString(),
});
/** Digest-pinned container reference. A mutable tag has no digest, so the schema rejects it. */
const digestPinnedImage = z.stringFormat("digest-pinned-image", /@sha256:[a-f0-9]{64}$/u);

export const env = createEnv({
  server: {
    /** Bearer the bot must present on every inbound channel route. */
    AGENT_INGRESS_SECRET: secret,
    /** Where to wake the bot for durable parked/render markers. */
    BOT_URL: httpUrl,
    /** Bearer the agent presents to the bot. */
    BOT_INGRESS_SECRET: secret,

    /** Audit log, scheduled tasks, shopping cart. */
    TURSO_DATABASE_URL: identifier,
    TURSO_AUTH_TOKEN: secret.optional(),

    /** Render coordination, token budgets, tools, and schedules. */
    UPSTASH_REDIS_REST_URL: httpUrl,
    UPSTASH_REDIS_REST_TOKEN: secret,

    SENTRY_DSN: httpUrl.optional(),
    SENTRY_TRACES_SAMPLE_RATE: unitFraction.optional(),
    SENTRY_RELEASE: identifier.optional(),

    /** Optional Phase-3/4 integration credentials. Tools deny when absent. */
    GLOBAL_CONFIG: httpUrl.optional(),
    CLOUDFLARE_API_TOKEN: secret.optional(),
    CLOUDFLARE_ACCOUNT_ID: identifier.optional(),
    LINEAR_API_KEY: secret.optional(),
    NOTION_TOKEN: secret.optional(),
    GITHUB_APP_ID: secret.optional(),
    GITHUB_APP_PRIVATE_KEY: secret.optional(),
    GITHUB_APP_INSTALLATION_ID: secret.optional(),
    GITHUB_ORG: identifier.optional(),
    FIGMA_ACCESS_TOKEN: secret.optional(),
    FIGMA_TEAM_ID: identifier.optional(),
    HCB_ORG_SLUG: identifier.optional(),
    SERPAPI_API_KEY: secret.optional(),
    EXA_API_KEY: secret.optional(),
    PHACK_ASK_API_KEY: secret.optional(),
    PAYLOAD_CMS_API_KEY: secret.optional(),
    HUNTER_API_KEY: secret.optional(),
    /**
     * Release upload and source maps, managed by the Vercel Sentry integration.
     * Its scopes are `project:read`, `project:releases`, `project:write` — the
     * subagent's tools read events and issues and cannot use it.
     */
    SENTRY_AUTH_TOKEN: secret.optional(),
    /** The subagent's own credential: a user token with `event:read`/`org:read`. */
    SENTRY_API_TOKEN: secret.optional(),
    SENTRY_ORG: identifier.optional(),
    VERCEL_API_TOKEN: secret.optional(),

    /**
     * Bot Sandbox supervision. Off by default. Enabling it without the full
     * bot-container set below fails the reconcile loudly rather than starting
     * a half-configured bot.
     */
    BOT_SANDBOX_ENABLED: z
      .stringbool({ truthy: ["true"], falsy: ["false"], case: "sensitive" })
      .default(false),
    /** Digest-pinned VCR reference. The schema rejects mutable tags. */
    BOT_IMAGE: digestPinnedImage.optional(),
    /** Injected into the bot container. Never read by this process. */
    DISCORD_BOT_TOKEN: secret.optional(),
    DISCORD_BOT_CLIENT_ID: secret.optional(),
    AGENT_URL: httpUrl.optional(),
    DASHBOARD_GLOBAL_CONFIG: secret.optional(),
    SHIP_API_KEY: secret.optional(),
    PHACK_API_TOKEN: secret.optional(),
    GROQ_API_KEY: secret.optional(),
    /**
     * Omit `VERCEL_TOKEN` to use the deployment's OIDC identity for the Sandbox
     * API. Vercel itself injects `VERCEL_PROJECT_ID`, so its presence means
     * nothing about intent — only the token does.
     */
    VERCEL_TOKEN: secret.optional(),
    VERCEL_TEAM_ID: secret.optional(),
    VERCEL_PROJECT_ID: secret.optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "1",
});

export type AgentEnv = typeof env;

/**
 * Turso connection settings, in the shape `getDb`/`createClient` take.
 *
 * `TURSO_AUTH_TOKEN` is optional and `exactOptionalPropertyTypes` refuses a
 * present-but-undefined key, so the conditional spread is mandatory rather
 * than stylistic. Four call sites each wrote their own copy before this
 * helper existed.
 */
export function tursoConfig(): TursoConfig {
  return {
    url: env.TURSO_DATABASE_URL,
    ...(env.TURSO_AUTH_TOKEN !== undefined && { authToken: env.TURSO_AUTH_TOKEN }),
  };
}
