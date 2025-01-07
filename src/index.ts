import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";
import cron from "node-cron";

import { commands } from "./commands";
import { evergreenIssueWorkflow } from "./events/message_create";

import { checkBirthdays } from "./utils/birthdays";

import { env } from "./env";

const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

try {
  console.log("Started refreshing application (/) commands.");

  const body = commands.map(({ data }) => data.toJSON());

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });

  console.log("Successfully reloaded application (/) commands.");
} catch (error) {
  console.error(error);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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

const checkBirthdaysTask = cron.schedule("1 0 * * *", checkBirthdays(client));

client.on(Events.ClientReady, (event) => {
  console.log(`Logged in as ${event.user.tag}!`);

  client.user?.setActivity({
    name: "eggz",
    type: ActivityType.Watching,
  });

  checkBirthdaysTask.start();
});

client.on(Events.MessageCreate, async (message) => {
  // run all event handlers in parallel
  // this may create race conditions, but
  // womp womp
  await Promise.all([evergreenIssueWorkflow(message)]);
});

client.login(env.DISCORD_BOT_TOKEN);

Bun.serve({
  fetch(request, server) {
    return new Response("Hello, world!", {
      headers: { "content-type": "text/plain" },
    });
  },
  port: 3000,
});
