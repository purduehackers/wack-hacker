import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_ENDPOINT_URL_S3: z.string(),
    AWS_REGION: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    BUCKET_NAME: z.string(),
    DISCORD_CLIENT_ID: z.string(),
    DISCORD_BOT_TOKEN: z.string(),
    GROQ_API_KEY: z.string(),
    TZ: z.string().default("America/Indiana/Indianapolis"),
  },
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});
