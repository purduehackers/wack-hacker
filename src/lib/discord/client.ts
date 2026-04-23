import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";

import { env } from "@/env";

/**
 * Build a Discord HTTP API client bound to the bot's token. Use at any call
 * site that needs to make Discord REST calls — routes, cron handlers, task
 * queue handlers, workflow steps. Each call returns a fresh client; the
 * underlying `REST` is cheap to construct.
 */
export function createDiscordAPI(): API {
  return new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
}
