import { log } from "evlog";

import { defineCron } from "@/bot/crons/define";
import { generateEventSlug } from "@/bot/integrations/hack-night";
import { R2Storage } from "@/bot/integrations/r2";
import { env } from "@/env";
import { DISCORD_IDS } from "@/lib/protocol/constants";

export const hackNightCleanup = defineCron({
  name: "hack-night-cleanup",
  schedule: "0 18 * * 0",
  async handle(discord) {
    const r2 = new R2Storage(
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.EVENTS_R2_BUCKET_NAME,
    );

    const now = new Date();
    const daysSinceFriday = (now.getDay() + 2) % 7;
    const friday = new Date(now);
    friday.setDate(now.getDate() - daysSinceFriday);
    const slug = generateEventSlug(friday);

    const index = await r2.getEventIndex(slug);
    if (!index || index.images.length === 0) {
      log.info("hack-night", `No images found for ${slug}`);
      return;
    }

    const channelId = DISCORD_IDS.channels.HACK_NIGHT;

    const counts = new Map<string, number>();
    for (const img of index.images) {
      counts.set(img.discordUserId, (counts.get(img.discordUserId) ?? 0) + 1);
    }

    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const topFive = ranked.slice(0, 5);

    await discord.channels.createMessage(channelId, {
      content: `Thanks for coming to Hack Night! ${index.images.length} photos were taken.`,
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

    const recentMessages = await discord.channels.getMessages(channelId, {
      limit: 10,
    });
    for (const msg of recentMessages) {
      if (msg.thread) {
        await discord.channels.edit(msg.thread.id, {
          archived: true,
          locked: true,
        });
        break;
      }
    }

    log.info("hack-night", `Cleanup complete for ${slug}: ${index.images.length} photos`);
  },
});
