import { MessageType } from "discord-api-types/v10";
import { log } from "evlog";

import { defineCron } from "@/bot/crons/define";
import { HackNightThreadStore, generateEventSlug } from "@/bot/integrations/hack-night";
import { DISCORD_IDS } from "@/lib/protocol/constants";

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

export const hackNightCreate = defineCron({
  name: "hack-night-create",
  schedule: "0 20 * * 5",
  async handle(discord) {
    const channelId = DISCORD_IDS.channels.HACK_NIGHT;
    const message = HACK_NIGHT_MESSAGES[Math.floor(Math.random() * HACK_NIGHT_MESSAGES.length)];

    const now = new Date();
    const dateString = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;

    const announcement = await discord.channels.createMessage(channelId, {
      content: `${message} \u{1F389}\n\nShare your pictures from the night in this thread!`,
    });

    await discord.channels.pinMessage(channelId, announcement.id);

    // Pinning produces a "ChannelPinnedMessage" system notice in the channel.
    // Delete that notice (if Discord has emitted it yet) without touching the
    // announcement itself — a naive delete-most-recent would race the pin and
    // could wipe the announcement we just created.
    const recent = await discord.channels.getMessages(channelId, { limit: 5 });
    const pinNotice = recent.find(
      (m) => m.type === MessageType.ChannelPinnedMessage && m.id !== announcement.id,
    );
    if (pinNotice) {
      await discord.channels.deleteMessage(channelId, pinNotice.id);
    }

    const thread = await discord.channels.createThread(
      channelId,
      {
        name: `Hack Night Images - ${dateString}`,
        auto_archive_duration: 1440,
      },
      announcement.id,
    );

    await discord.channels.createMessage(thread.id, {
      content: `(<@&${DISCORD_IDS.roles.HACK_NIGHT_PING}>)`,
    });

    const slug = generateEventSlug(now);
    await new HackNightThreadStore().set(thread.id, slug);

    log.info("hack-night", `Created thread ${thread.id} for Hack Night (slug=${slug})`);
  },
});
