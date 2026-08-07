import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const secret = z.string().min(1);
const optionalSecret = secret.optional();

/** This deployment alone receives operational and bot-container credentials. */
export const env = createEnv({
  server: {
    BOT_SANDBOX_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    CRON_SECRET: secret,
    BOT_IMAGE: z
      .string()
      .regex(/@sha256:[a-f0-9]{64}$/u)
      .optional(),
    DISCORD_BOT_TOKEN: optionalSecret,
    DISCORD_BOT_CLIENT_ID: optionalSecret,
    AGENT_URL: z.url().optional(),
    AGENT_INGRESS_SECRET: optionalSecret,
    BOT_INGRESS_SECRET: optionalSecret,
    UPSTASH_REDIS_REST_URL: z.url(),
    UPSTASH_REDIS_REST_TOKEN: secret,
    PRIVACY_DB_API_KEY: optionalSecret,
    VERCEL_API_TOKEN: optionalSecret,
    DASHBOARD_EDGE_CONFIG: optionalSecret,
    PAYLOAD_CMS_API_KEY: optionalSecret,
    SHIP_API_KEY: optionalSecret,
    PHACK_API_TOKEN: optionalSecret,
    GROQ_API_KEY: optionalSecret,
    SENTRY_DSN: z.url().optional(),
    SENTRY_RELEASE: z.string().min(1).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
    VERCEL_TOKEN: optionalSecret,
    VERCEL_TEAM_ID: optionalSecret,
    VERCEL_PROJECT_ID: optionalSecret,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env["SKIP_ENV_VALIDATION"] === "1",
});
