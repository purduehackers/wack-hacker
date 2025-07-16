import dayjs from "dayjs";
import {
  ChatInputCommandInteraction,
  Message,
  MessageFlags,
  MessagePayload,
  TextChannel,
  type GuildTextBasedChannel,
  type MessageReplyOptions,
  type OmitPartialGroupDMChannel,
  type PublicThreadChannel,
  type TextBasedChannel,
} from "discord.js";
import human from "human-interval";
import Groq from "groq-sdk";
import { env } from "../env";
const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export async function summarize(
  timeframe: string | null,
  top: string | null,
  replyable: Message<true> | ChatInputCommandInteraction,
) {
  const timeframeMs = human(timeframe ?? "1 hour");
  const topic =
    top || "whatever the most common theme of the previous messages is";
  const displayTopic = top || "WHATEVER";

  if (!timeframeMs) {
    await replyable.reply("Invalid timeframe provided");
    return;
  }

  const date = new Date(Date.now() - timeframeMs);
  const formatted = dayjs(date).fromNow();

  if (replyable instanceof ChatInputCommandInteraction) {
    await replyable.reply({
      content: `Summarizing messages related to ${topic} from ${formatted}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const snowflake = (
    (BigInt(date.valueOf()) - BigInt(1420070400000)) <<
    BigInt(22)
  ).toString();

  const channel = replyable.channel as TextChannel;

  const messages = await channel.messages.fetch({
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

  const thread = (await channel.threads.create({
    name: `Summary of ${displayTopic} from ${formatted}`,
    autoArchiveDuration: 60,
    reason: `Summarizing messages related to ${displayTopic} from ${formatted}.`,
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
