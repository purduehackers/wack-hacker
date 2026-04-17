import { SlashCommandBuilder } from "discord.js";
import { log } from "evlog";

import { defineCommand } from "@/bot/commands/define";
import { isOrganizer, respond } from "@/bot/commands/helpers";
import { env } from "@/env";

const FAILURE_MSG = "Failed to restart the bot. Try again later.";
const GATEWAY_TIMEOUT_MS = 10_000;

function gatewayUrl(): string {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  if (!host) return "http://localhost:3000/api/discord/gateway";
  return `https://${host}/api/discord/gateway`;
}

export const restartBot = defineCommand({
  builder: new SlashCommandBuilder()
    .setName("restart-bot")
    .setDescription("Restart the discord gateway listener (organizers only)"),
  async execute(ctx) {
    if (!isOrganizer(ctx)) {
      await respond(ctx, "You need the Organizer role to use this command.");
      return;
    }

    try {
      const res = await fetch(gatewayUrl(), {
        method: "GET",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-store, no-cache, max-age=0",
          Pragma: "no-cache",
        },
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });

      if (!res.ok) {
        log.warn("restart-bot", `Gateway returned ${res.status}`);
        await respond(ctx, FAILURE_MSG);
        return;
      }

      await respond(ctx, "Bot restart triggered.");
    } catch (err) {
      log.warn("restart-bot", `Gateway request failed: ${String(err)}`);
      await respond(ctx, FAILURE_MSG);
    }
  },
});
