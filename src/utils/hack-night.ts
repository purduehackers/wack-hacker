import dayjs from "dayjs";
import {
  ChannelType,
  ThreadAutoArchiveDuration,
  type Client,
} from "discord.js";

import {
  HACK_NIGHT_CHANNEL_ID,
  HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID,
} from "./consts";

// TODO(@rayhanadev): add more fun messages
const HACK_NIGHT_MESSAGES = [
  "Happy Hack Night! :D",
  "Welcome to Hack Night! :D",
  "Hack Night is here! :D",
  "It's Hack Night! :D",
  "Hack Night is starting! :D",
  "Let's get hacking! :D",
  "Time to hack! :D",
  "Hack Night is live! :D",
  "Hack Night is a go! :D",
];
const SEND_LEADERBOARD_MESSAGE = true;

export function createHackNightImagesThread(client: Client) {
  return async function () {
    const channel = client.channels.cache.get(HACK_NIGHT_CHANNEL_ID);

    if (!channel) {
      console.error("Could not find channel: #hack-night");
      return;
    }

    if (!channel.isSendable()) {
      console.error("Cannot send messages to #hack-night");
      return;
    }

    const message = await channel.send({
      content: `${HACK_NIGHT_MESSAGES[Math.floor(Math.random() * HACK_NIGHT_MESSAGES.length)]} 🎉\n\nShare your pictures from the day in this thread!`,
    });

    if (!message) {
      console.error("Could not create Hack Night images thread");
      return;
    }

    await message.pin();

    const date = dayjs().format("MM/DD");

    await message.startThread({
      name: `Hack Night Images - ${date}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });

    const pinnedMessage = await channel.messages.fetch({ limit: 1 });

    if (!pinnedMessage) {
      console.error("Could not fetch last message");
      return;
    }

    const systemMessage = pinnedMessage.first();

    if (!systemMessage) {
      console.error("Could not find last message");
      return;
    }

    await systemMessage.delete();

    console.log("Created Hack Night images thread");
  };
}

export function cleanupHackNightImagesThread(client: Client) {
  return async function () {
    const channel = client.channels.cache.get(HACK_NIGHT_CHANNEL_ID);

    if (!channel) {
      console.error("Could not find channel: #hack-night");
      return;
    }

    if (!channel.isSendable()) {
      console.error("Cannot send messages to #hack-night");
      return;
    }

    if (channel.type !== ChannelType.GuildText) {
      console.error("Cannot create threads in #hack-night");
      return;
    }

    const threads = await channel.threads.fetchActive();

    if (!threads) {
      console.error("Could not fetch active threads");
      return;
    }

    const hackNightImageThread = threads.threads
      .filter((t) => {
        return t.name.startsWith("Hack Night Images");
      })
      .sorted((a, b) => {
        if (!a.createdTimestamp || !b.createdTimestamp) return 0;
        return b.createdTimestamp - a.createdTimestamp;
      })
      .first();

    if (!hackNightImageThread) {
      console.error("Could not find latest thread");
      return;
    }

    const snowflake = (
      (BigInt(new Date().getTime() - 1000 * 60 * 60 * 46) -
        BigInt(1420070400000)) <<
      BigInt(22)
    ).toString();

    const messages = await hackNightImageThread.messages.fetch({
      limit: 100,
      after: snowflake,
    });

    if (!messages) {
      console.error("Could not fetch messages");
      return;
    }

    const contributors = new Map<string, number>();

    for (const message of messages.values()) {
      if (message.attachments.size === 0) continue;

      const author = message.author.id;
      const count = contributors.get(author) ?? 0;
      contributors.set(author, count + message.attachments.size);
    }

    const attachments = messages
      .filter((m) => m.attachments.size > 0)
      .map((m) => [...m.attachments.values()])
      .flat();

    if (attachments.length === 0) {
      console.error("No attachments found");
      return;
    }

    const starterMessage = await hackNightImageThread.fetchStarterMessage();

    if (!starterMessage) {
      console.error("Could not fetch starter message");
      return;
    }

    const topContributors = Array.from(contributors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (SEND_LEADERBOARD_MESSAGE) {
      await starterMessage.reply({
        content: `Thanks for coming to Hack Night! We took ${attachments.length} picture${attachments.length === 1 ? "" : "s"} :D`,
      });

      await channel.send({
        content: `Our top contributors this week are:
${topContributors
  .map(([id, count], index) => `\n#${index + 1}: <@${id}> - ${count}`)
  .join("")
  .trim()}`,
      });
    }

    // TODO(@rayhanadev): upload all these images to the Sanity project
    // TODO(@rayhanadev): filter out files that are not images
    const images = [...attachments.map((a) => a.url)];

    await starterMessage.unpin();
    await hackNightImageThread.setLocked(true);
    await hackNightImageThread.setArchived(true);

    const roleHolder = await channel.guild.roles
      .fetch(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID)
      .then((r) => {
        return r?.members;
      });

    if (roleHolder) {
      for (const member of roleHolder.values()) {
        await member.roles.remove(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID);
      }
    }

    const winner = topContributors[0];

    if (winner) {
      await channel.guild.members.fetch(winner).then((m) => {
        m.roles.add(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID);
      });
    }

    await channel.send({
      content: `Congratulations to <@${winner}> for winning the Hack Night Photography Award! :D`,
    });
    await channel.send({
      content: "Happy hacking, and see you next time! :D",
    });

    console.log("Cleaned up Hack Night images thread");
  };
}
