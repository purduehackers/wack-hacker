import type { SlashCommand } from "../src/bot/commands/types";

import { DISCORD_GUILD_ID } from "../src/lib/protocol/constants";

const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv && vercelEnv !== "production") {
  console.log(`Skipping command registration on VERCEL_ENV=${vercelEnv}`);
  process.exit(0);
}

const { REST, Routes } = await import("discord.js");
const commands = await import("../src/bot/handlers/commands");

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_BOT_CLIENT_ID;

if (!token || !clientId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_BOT_CLIENT_ID are required");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

const payload = Object.values(commands)
  .filter((v): v is SlashCommand => !!v && typeof v === "object" && "builder" in v)
  .map((c) => c.builder.toJSON());

const route = Routes.applicationGuildCommands(clientId, DISCORD_GUILD_ID);

await rest.put(route, { body: payload });

console.log(`Registered ${payload.length} commands to guild ${DISCORD_GUILD_ID}`);
