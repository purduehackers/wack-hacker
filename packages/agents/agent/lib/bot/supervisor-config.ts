/**
 * The bot container's environment, projected from this deployment's own.
 *
 * The split matters: the agent validates *its* env at boot, but the bot's env
 * is data handed to another process, so it is assembled and validated here
 * rather than read from a singleton inside the supervision code. Every variable
 * the bot needs is optional in `env.ts` and required here, which is what makes
 * "supervision disabled" a working deployment and "supervision enabled but
 * incomplete" a loud failure on the reconcile tick rather than a half-started
 * bot.
 *
 * Reasoning and domain tools never read these values; they exist only to be
 * injected into the container this deployment starts.
 */

import type { AgentEnv } from "../../env.ts";
import {
  BOT_PORT_DEFAULT,
  InvalidBotSandboxConfig,
  type BotProcessEnvironment,
  type BotSandboxCredentials,
} from "./supervisor.ts";

export interface BotSupervisionConfig {
  /** Digest-pinned VCR image the bot container runs. */
  readonly image: string;
  readonly botEnv: BotProcessEnvironment;
  /** Omitted when the host authenticates to Vercel with OIDC. */
  readonly credentials?: BotSandboxCredentials;
}

function required(value: string | undefined, field: keyof BotProcessEnvironment): string {
  if (value !== undefined) return value;
  throw new InvalidBotSandboxConfig({
    field: "botEnv",
    detail: `${field} is required when Sandbox supervision is enabled`,
  });
}

/**
 * Explicit Vercel credentials, or nothing at all.
 *
 * The *token* decides which mode this is, not the presence of any of the three.
 * `VERCEL_PROJECT_ID` is a system variable Vercel injects into every runtime, so
 * a rule of "all three absent means OIDC" can never be satisfied on Vercel —
 * which was the only platform it existed for. It failed every reconcile with
 * `InvalidBotSandboxConfig` instead, and the bot was never provisioned.
 *
 * A partial set is still rejected once a token is present: a token without its
 * team or project means someone intended token auth and mistyped a name, and
 * silently falling back would authenticate as the wrong identity.
 */
function credentials(source: AgentEnv): BotSandboxCredentials | undefined {
  const token = source.VERCEL_TOKEN;
  // No token: authenticate with the deployment's own OIDC identity, whatever
  // ambient ids the platform happens to have set.
  if (token === undefined) return undefined;
  const teamId = source.VERCEL_TEAM_ID;
  const projectId = source.VERCEL_PROJECT_ID;
  if (teamId === undefined || projectId === undefined) {
    throw new InvalidBotSandboxConfig({
      field: "credentials",
      detail: "VERCEL_TOKEN requires VERCEL_TEAM_ID and VERCEL_PROJECT_ID to be set with it",
    });
  }
  return { token, teamId, projectId };
}

function botEnvironment(source: AgentEnv): BotProcessEnvironment {
  return {
    DISCORD_BOT_TOKEN: required(source.DISCORD_BOT_TOKEN, "DISCORD_BOT_TOKEN"),
    DISCORD_BOT_CLIENT_ID: required(source.DISCORD_BOT_CLIENT_ID, "DISCORD_BOT_CLIENT_ID"),
    AGENT_URL: required(source.AGENT_URL, "AGENT_URL"),
    AGENT_INGRESS_SECRET: required(source.AGENT_INGRESS_SECRET, "AGENT_INGRESS_SECRET"),
    BOT_INGRESS_SECRET: required(source.BOT_INGRESS_SECRET, "BOT_INGRESS_SECRET"),
    UPSTASH_REDIS_REST_URL: source.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: source.UPSTASH_REDIS_REST_TOKEN,
    VERCEL_API_TOKEN: required(source.VERCEL_API_TOKEN, "VERCEL_API_TOKEN"),
    DASHBOARD_GLOBAL_CONFIG: required(source.DASHBOARD_GLOBAL_CONFIG, "DASHBOARD_GLOBAL_CONFIG"),
    PAYLOAD_CMS_API_KEY: required(source.PAYLOAD_CMS_API_KEY, "PAYLOAD_CMS_API_KEY"),
    SHIP_API_KEY: required(source.SHIP_API_KEY, "SHIP_API_KEY"),
    PHACK_API_KEY: required(source.PHACK_API_KEY, "PHACK_API_KEY"),
    GROQ_API_KEY: required(source.GROQ_API_KEY, "GROQ_API_KEY"),
    PORT: String(BOT_PORT_DEFAULT),
    ...(source.SENTRY_DSN === undefined ? {} : { SENTRY_DSN: source.SENTRY_DSN }),
    ...(source.SENTRY_RELEASE === undefined ? {} : { SENTRY_RELEASE: source.SENTRY_RELEASE }),
    ...(source.SENTRY_TRACES_SAMPLE_RATE === undefined
      ? {}
      : { SENTRY_TRACES_SAMPLE_RATE: String(source.SENTRY_TRACES_SAMPLE_RATE) }),
  };
}

/** Throws `InvalidBotSandboxConfig` so a misconfigured supervisor fails at boot. */
export function botSupervisionConfig(source: AgentEnv): BotSupervisionConfig {
  if (source.BOT_IMAGE === undefined) {
    throw new InvalidBotSandboxConfig({
      field: "BOT_IMAGE",
      detail: "a digest-pinned image is required when Sandbox supervision is enabled",
    });
  }
  const explicit = credentials(source);
  return {
    image: source.BOT_IMAGE,
    botEnv: botEnvironment(source),
    ...(explicit === undefined ? {} : { credentials: explicit }),
  };
}
