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
		R2_ACCOUNT_ID: z.string(),
		R2_ACCESS_KEY_ID: z.string(),
		R2_SECRET_ACCESS_KEY: z.string(),
		R2_BUCKET_NAME: z.string(),
		R2_PUBLIC_URL: z.string(),
	},
	runtimeEnv: Bun.env,
	emptyStringAsUndefined: true,
});
