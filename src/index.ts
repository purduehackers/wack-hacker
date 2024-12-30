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
import {
  getBirthdaysToday,
  generateBirthdayMessage,
} from "./commands/birthday";
import { LOUNGE_CHANNEL_ID } from "./utils/consts";
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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const checkBirthdaysTask = cron.schedule("1 0 * * *", checkBirthdays);

client.on(Events.ClientReady, (event) => {
  console.log(`Logged in as ${event.user.tag}!`);

  client.user?.setActivity({
    name: "eggz",
    type: ActivityType.Watching,
  });

  checkBirthdaysTask.start();
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

Bun.serve({
  fetch(request, server) {
    return new Response("Hello, world!", {
      headers: { "content-type": "text/plain" },
    });
  },
  port: 3000,
});

async function checkBirthdays() {
  const birthdays = await getBirthdaysToday();

  if (birthdays.length === 0) return;

  const channel = client.channels.cache.get(LOUNGE_CHANNEL_ID);

  if (!channel) {
    console.error("Could not find channel: #lounge");
    return;
  }

  if (!channel.isSendable()) {
    console.error("Cannot send messages to #lounge");
    return;
  }

  for (const birthday of birthdays) {
    channel.send({
      content: generateBirthdayMessage(birthday.userId),
    });
  }
}
