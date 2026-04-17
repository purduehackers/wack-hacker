import type { SlashCommand } from "../src/bot/commands/types";

const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv && vercelEnv !== "production") {
  console.log(`Skipping command registration on VERCEL_ENV=${vercelEnv}`);
  process.exit(0);
}

const { REST, Routes } = await import("discord.js");
const commands = await import("../src/bot/handlers/commands");

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

const payload = Object.values(commands)
  .filter((v): v is SlashCommand => !!v && typeof v === "object" && "builder" in v)
  .map((c) => c.builder.toJSON());

const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: payload });

console.log(
  `Registered ${payload.length} commands${guildId ? ` to guild ${guildId}` : " globally"}`,
);
