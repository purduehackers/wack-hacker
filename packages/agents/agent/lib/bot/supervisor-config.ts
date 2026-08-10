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
 * A partial set is rejected rather than merged with OIDC: two of three
 * variables means someone intended token auth and mistyped a name, and
 * silently falling back would authenticate as the wrong identity.
 */
function credentials(source: AgentEnv): BotSandboxCredentials | undefined {
  const configured = [source.VERCEL_TOKEN, source.VERCEL_TEAM_ID, source.VERCEL_PROJECT_ID];
  if (configured.every((entry) => entry === undefined)) return undefined;
  if (configured.some((entry) => entry === undefined)) {
    throw new InvalidBotSandboxConfig({
      field: "credentials",
      detail: "VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID must be set together",
    });
  }
  return {
    token: source.VERCEL_TOKEN ?? "",
    teamId: source.VERCEL_TEAM_ID ?? "",
    projectId: source.VERCEL_PROJECT_ID ?? "",
  };
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
    DASHBOARD_EDGE_CONFIG: required(source.DASHBOARD_EDGE_CONFIG, "DASHBOARD_EDGE_CONFIG"),
    PAYLOAD_CMS_API_KEY: required(source.PAYLOAD_CMS_API_KEY, "PAYLOAD_CMS_API_KEY"),
    SHIP_API_KEY: required(source.SHIP_API_KEY, "SHIP_API_KEY"),
    PHACK_API_TOKEN: required(source.PHACK_API_TOKEN, "PHACK_API_TOKEN"),
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
