import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type PublicThreadChannel,
} from "discord.js";
import Groq from "groq-sdk";
import human from "human-interval";

import { env } from "~/env";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

dayjs.extend(relativeTime);

export const data = new SlashCommandBuilder()
  .setName("summarize")
  .setDescription("Summarize a specific topic from previously sent messages")
  .addStringOption((option) =>
    option
      .setName("topic")
      .setDescription("The topic to summarize (e.g. breakdancing)")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("timeframe")
      .setDescription(
        "The timeframe of past messages to consider (e.g. 1 hour, 30 mins)",
      )
      .setRequired(false),
  );

export async function command(interaction: ChatInputCommandInteraction) {
  const { options } = interaction;

  const topic = options.getString("topic");
  const timeframe = options.getString("timeframe") ?? "1 hour";

  if (!topic) {
    await interaction.reply("Please provide a topic to summarize");
    return;
  }

  const timeframeMs = human(timeframe);

  if (!timeframeMs) {
    await interaction.reply("Invalid timeframe provided");
    return;
  }

  const date = new Date(Date.now() - timeframeMs);
  const formatted = dayjs(date).fromNow();

  await interaction.reply({
    content: `Summarizing messages related to ${topic} from ${formatted}.`,
    flags: MessageFlags.Ephemeral,
  });

  const isChannel = interaction.channel;

  if (!isChannel) {
    await interaction.reply("This command can only be used in a channel");
    return;
  }

  const snowflake = (
    (BigInt(date.valueOf()) - BigInt(1420070400000)) <<
    BigInt(22)
  ).toString();

  const messages = await interaction.channel.messages.fetch({
    limit: 100,
    after: snowflake,
  });

  const corpus = messages
    .reverse()
    .map(
      (message) =>
        `[${message.author.displayName} ${new Date(message.createdTimestamp).toISOString()}] ${message.content}`,
    )
    .join("\n");

  const content = `
${corpus}


Using the above message corpus, generate a bulleted summary of anything relevant to the following topic: **${topic}**. Mention specific things people said and anything useful to document. Pull all details relevant to ${topic}.

When reading a message, the first part is the username and the second part is the timestamp. For example, [User A 2021-08-01T00:00:00.000Z].

Avoid pinging users, only use their username (e.g. Ray said ...). Follow all markdown rules relevant to Discord.

Use an analytical tone. Include relevant details. For example, "User A mentioned that they were going to the store. User B responded with a question about the store's location."
Include as much detail as possible. At the end summarize any conclusions or decisions made.
`.trim();

  const response = await groq.chat.completions.create({
    messages: [
      {
        role: "user",
        content,
      },
    ],
    model: "llama-3.3-70b-versatile",
  });

  const thread = (await interaction.channel.threads.create({
    name: `Summary of ${topic} from ${formatted}`,
    autoArchiveDuration: 60,
    reason: `Summarizing messages related to ${topic} from ${formatted}.`,
  })) as PublicThreadChannel<false>;

  const message = response.choices[0].message;

  if (!message.content) {
    console.error("No content");
    await thread.send("Error: No content");
    return;
  }

  if (message.content.length > 2000) {
    const chunks = message.content.match(/[\s\S]{1,2000}/g);

    if (!chunks) {
      console.error("No chunks");
      await thread.send("Error: No chunks");
      return;
    }

    for (const chunk of chunks) {
      console.log(chunk);
      await thread.send(chunk);
    }
  } else {
    await thread.send(message.content);
  }
}
