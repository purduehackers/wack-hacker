import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";

import { commands } from "./commands";
import { env } from "~/env";

const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

try {
  console.log("Started refreshing application (/) commands.");

  const body = commands.map(({ data }) => data.toJSON());

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });

  console.log("Successfully reloaded application (/) commands.");
} catch (error) {
  console.error(error);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.ClientReady, (event) => {
  console.log(`Logged in as ${event.user.tag}!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    const command = commands.find((c) => c.data.name === commandName);

    if (!command) {
      await interaction.reply({
        content: "This command does not exist!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await command.command(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

client.login(env.DISCORD_BOT_TOKEN);
