import { log } from "evlog";

import { defineCron } from "@/bot/crons/define";
import { findMediaByBatchId, getBatchId, hackNightDateKey } from "@/bot/integrations/payload";
import { DISCORD_IDS } from "@/lib/protocol/constants";

export const hackNightCleanup = defineCron({
  name: "hack-night-cleanup",
  schedule: "0 18 * * 0",
  async handle(discord) {
    const dateKey = hackNightDateKey(new Date());
    const batchId = await getBatchId(dateKey);
    if (!batchId) {
      log.info("hack-night", `No batch recorded for ${dateKey}`);
      return;
    }

    const media = await findMediaByBatchId(batchId);
    if (media.totalDocs === 0) {
      log.info("hack-night", `No media for batch ${batchId} (${dateKey})`);
      return;
    }

    const channelId = DISCORD_IDS.channels.HACK_NIGHT;

    const counts = new Map<string, number>();
    for (const doc of media.docs) {
      const userId = doc.discordUserId;
      if (!userId) continue;
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }

    const topFive = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    await discord.channels.createMessage(channelId, {
      content: `Thanks for coming to Hack Night! ${media.totalDocs} photos were taken.`,
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

    const recentMessages = await discord.channels.getMessages(channelId, { limit: 10 });
    for (const msg of recentMessages) {
      if (msg.thread) {
        await discord.channels.edit(msg.thread.id, { archived: true, locked: true });
        break;
      }
    }

    await discord.channels.createMessage(DISCORD_IDS.channels.PROJECT_HACK_NIGHT, {
      content:
        `Hack Night **${dateKey}** photos are ready to link.\n` +
        `Batch: \`${batchId}\` (${media.totalDocs} photos)\n` +
        `Filter the Media list in Payload by \`batchId=${batchId}\` and attach to the event row.`,
    });

    log.info("hack-night", `Cleanup complete for ${dateKey}: ${media.totalDocs} photos`);
  },
});
