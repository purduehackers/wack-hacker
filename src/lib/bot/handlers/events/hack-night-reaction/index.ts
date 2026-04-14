import { log } from "evlog";

import { env } from "@/env";
import { defineEvent } from "@/lib/bot/events/define";
import { generateEventSlug } from "@/lib/bot/integrations/hack-night";
import { R2Storage } from "@/lib/bot/integrations/r2";
import { DISCORD_IDS } from "@/lib/protocol/constants";

export const hackNightReaction = defineEvent({
  type: "reactionAdd",
  async handle(packet, ctx) {
    if (packet.data.emoji.name !== "\u274C") return;

    const { messageId, channelId, guildId, creator } = packet.data;

    const message = await ctx.discord.channels.getMessage(channelId, messageId);
    const isAuthor = message.author?.id === creator.id;

    if (!isAuthor) {
      const member = await ctx.discord.guilds.getMember(guildId, creator.id);
      if (!member.roles.includes(DISCORD_IDS.roles.ORGANIZER)) return;
    }

    const r2 = new R2Storage(
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.EVENTS_R2_BUCKET_NAME,
    );
    const slug = generateEventSlug(new Date());
    const removed = await r2.removeImagesForMessage(slug, messageId);
    if (removed > 0) {
      await ctx.discord.channels.deleteOwnMessageReaction(channelId, messageId, "\u2705");
      log.info("hack-night", `Removed ${removed} images for message ${messageId} by ${creator.id}`);
    }
  },
});
