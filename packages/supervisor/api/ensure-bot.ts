import type { IncomingMessage, ServerResponse } from "node:http";

import { bearerMatches } from "../../shared/src/bearer.ts";
import { getRedis } from "../../shared/src/redis/client.ts";
import { Result } from "../../shared/src/result/index.ts";
import {
  createBotSandboxSupervisor,
  InvalidBotSandboxConfig,
  type BotProcessEnvironment,
  type BotSandboxCredentials,
} from "../src/bot-sandbox.ts";
import { env } from "../src/env.ts";

export const maxDuration = 300;

function required(value: string | undefined, field: keyof BotProcessEnvironment): string {
  if (value !== undefined) return value;
  throw new InvalidBotSandboxConfig({
    field: "botEnv",
    detail: `${field} is required when Sandbox supervision is enabled`,
  });
}

function credentials(): BotSandboxCredentials | undefined {
  const configuredCredentials = [env.VERCEL_TOKEN, env.VERCEL_TEAM_ID, env.VERCEL_PROJECT_ID];
  if (configuredCredentials.every((entry) => entry === undefined)) return undefined;
  if (configuredCredentials.some((entry) => entry === undefined)) {
    throw new InvalidBotSandboxConfig({
      field: "credentials",
      detail: "VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID must be set together",
    });
  }
  return {
    token: env.VERCEL_TOKEN ?? "",
    teamId: env.VERCEL_TEAM_ID ?? "",
    projectId: env.VERCEL_PROJECT_ID ?? "",
  };
}

function botEnvironment(): BotProcessEnvironment {
  return {
    DISCORD_BOT_TOKEN: required(env.DISCORD_BOT_TOKEN, "DISCORD_BOT_TOKEN"),
    DISCORD_BOT_CLIENT_ID: required(env.DISCORD_BOT_CLIENT_ID, "DISCORD_BOT_CLIENT_ID"),
    AGENT_URL: required(env.AGENT_URL, "AGENT_URL"),
    AGENT_INGRESS_SECRET: required(env.AGENT_INGRESS_SECRET, "AGENT_INGRESS_SECRET"),
    BOT_INGRESS_SECRET: required(env.BOT_INGRESS_SECRET, "BOT_INGRESS_SECRET"),
    UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    PRIVACY_DB_API_KEY: required(env.PRIVACY_DB_API_KEY, "PRIVACY_DB_API_KEY"),
    VERCEL_API_TOKEN: required(env.VERCEL_API_TOKEN, "VERCEL_API_TOKEN"),
    DASHBOARD_EDGE_CONFIG: required(env.DASHBOARD_EDGE_CONFIG, "DASHBOARD_EDGE_CONFIG"),
    PAYLOAD_CMS_API_KEY: required(env.PAYLOAD_CMS_API_KEY, "PAYLOAD_CMS_API_KEY"),
    SHIP_API_KEY: required(env.SHIP_API_KEY, "SHIP_API_KEY"),
    PHACK_API_TOKEN: required(env.PHACK_API_TOKEN, "PHACK_API_TOKEN"),
    GROQ_API_KEY: required(env.GROQ_API_KEY, "GROQ_API_KEY"),
    PORT: "8080",
    ...(env.SENTRY_DSN === undefined ? {} : { SENTRY_DSN: env.SENTRY_DSN }),
    ...(env.SENTRY_RELEASE === undefined ? {} : { SENTRY_RELEASE: env.SENTRY_RELEASE }),
    ...(env.SENTRY_TRACES_SAMPLE_RATE === undefined
      ? {}
      : { SENTRY_TRACES_SAMPLE_RATE: String(env.SENTRY_TRACES_SAMPLE_RATE) }),
  };
}

export default async function ensureBot(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const authorization = request.headers.authorization;
  const presented = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!bearerMatches(presented, env.CRON_SECRET)) {
    response.statusCode = 401;
    response.end("unauthorized");
    return;
  }
  if (!env.BOT_SANDBOX_ENABLED) {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (env.BOT_IMAGE === undefined) {
    throw new InvalidBotSandboxConfig({
      field: "BOT_IMAGE",
      detail: "a digest-pinned image is required when Sandbox supervision is enabled",
    });
  }

  const explicitCredentials = credentials();
  const supervisor = createBotSandboxSupervisor({
    redis: getRedis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    image: env.BOT_IMAGE,
    botEnv: botEnvironment(),
    ...(explicitCredentials === undefined ? {} : { credentials: explicitCredentials }),
  });
  const outcome = await supervisor.ensure();
  if (Result.isError(outcome)) throw outcome.error;
  console.info(
    JSON.stringify({
      event: "bot.sandbox.ensure",
      status: outcome.value.status,
      sandboxName: outcome.value.active.sandboxName,
      generation: outcome.value.active.generation,
      expiresAt: outcome.value.active.expiresAt,
    }),
  );
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ ok: true, status: outcome.value.status }));
}
