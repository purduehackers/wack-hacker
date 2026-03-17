import { z } from "zod";

const schema = z.object({
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
});

/**
 * Validated environment variables. Parsed lazily on first property access
 * so importing this module doesn't crash in contexts where env vars
 * aren't yet available (e.g. workflow step bundles at load time).
 */
let _parsed: z.infer<typeof schema> | undefined;

export const env = new Proxy({} as z.infer<typeof schema>, {
  get(_, prop: string) {
    _parsed ??= schema.parse(process.env);
    return _parsed[prop as keyof typeof _parsed];
  },
});
