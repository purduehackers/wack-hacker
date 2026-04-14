import { SlashCommandBuilder } from "discord.js";

import { defineCommand } from "@/lib/bot/commands/define";
import { respond } from "@/lib/bot/commands/helpers";

const DISCORD_EPOCH = 1420070400000n;

export const ping = defineCommand({
  builder: new SlashCommandBuilder().setName("ping").setDescription("Check if the bot is alive"),
  async execute(ctx) {
    const snowflake = BigInt(ctx.interaction.id);
    const interactionTime = Number((snowflake >> 22n) + DISCORD_EPOCH);
    const latency = Date.now() - interactionTime;
    await respond(ctx, `Pong! (${latency}ms)`);
  },
});
