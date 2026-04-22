import { log } from "evlog";

import { defineCron } from "@/bot/crons/define";
import { listHackNightImages } from "@/bot/integrations/cms";
import { resolveEventSlug } from "@/bot/integrations/hack-night";
import { DISCORD_IDS } from "@/lib/protocol/constants";

export const hackNightCleanup = defineCron({
  name: "hack-night-cleanup",
  schedule: "0 18 * * 0",
  async handle(discord) {
    const channelId = DISCORD_IDS.channels.HACK_NIGHT;

    const recentMessages = await discord.channels.getMessages(channelId, { limit: 10 });
    const activeThread = recentMessages.find((m) => m.thread)?.thread;

    if (!activeThread) {
      log.info("hack-night", "No active hack-night thread found");
      return;
    }

    const now = new Date();
    const daysSinceFriday = (now.getDay() + 2) % 7;
    const friday = new Date(now);
    friday.setDate(now.getDate() - daysSinceFriday);
    const slug = await resolveEventSlug(activeThread.id, friday);

    const images = await listHackNightImages(slug);
    if (images.length === 0) {
      log.info("hack-night", `No images found for ${slug}`);
      await discord.channels.edit(activeThread.id, { archived: true, locked: true });
      return;
    }

    const counts = new Map<string, number>();
    for (const img of images) {
      counts.set(img.discordUserId, (counts.get(img.discordUserId) ?? 0) + 1);
    }

    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const topFive = ranked.slice(0, 5);

    await discord.channels.createMessage(channelId, {
      content: `Thanks for coming to Hack Night! ${images.length} photos were taken.`,
    });

    if (topFive.length > 0) {
      const leaderboard = topFive
        .map(([userId, count], i) => `${i + 1}. <@${userId}> — ${count} photos`)
        .join("\n");
      await discord.channels.createMessage(channelId, {
        content: `**Top Photographers:**\n${leaderboard}`,
      });
    }

    await discord.channels.createMessage(channelId, {
      content: "Happy hacking, and see you next time! :D",
    });

    await discord.channels.edit(activeThread.id, { archived: true, locked: true });

    log.info("hack-night", `Cleanup complete for ${slug}: ${images.length} photos`);
  },
});
