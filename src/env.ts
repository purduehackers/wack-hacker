import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DISCORD_CLIENT_ID: z.string(),
    DISCORD_BOT_TOKEN: z.string(),
    GROQ_API_KEY: z.string(),
    GITHUB_TOKEN: z.string(),
    PHACK_API_TOKEN: z.string(),
    TZ: z.string().default("America/Indiana/Indianapolis"),
  },
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});
