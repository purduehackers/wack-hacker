import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DISCORD_BOT_TOKEN: z.string(),
    DISCORD_APPLICATION_ID: z.string(),
    DISCORD_PUBLIC_KEY: z.string(),
    DISCORD_GUILD_ID: z.string(),
    GITHUB_ORG: z.string().default("purduehackers"),
    LINEAR_API_KEY: z.string(),
    NOTION_TOKEN: z.string(),
    GITHUB_APP_ID: z.string(),
    GITHUB_APP_PRIVATE_KEY: z.string(),
    GITHUB_APP_INSTALLATION_ID: z.string(),
    PHACK_ASK_API_KEY: z.string(),
    REDIS_URL: z.string(),
  },
  runtimeEnv: process.env,
});
