import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { deleteHackNightImagesForMessage } from "@/bot/integrations/cms";
import { generateEventSlug } from "@/bot/integrations/hack-night";
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

    const slug = generateEventSlug(new Date());
    const removed = await deleteHackNightImagesForMessage(slug, messageId);
    if (removed > 0) {
      await ctx.discord.channels.deleteOwnMessageReaction(channelId, messageId, "\u2705");
      log.info("hack-night", `Removed ${removed} images for message ${messageId} by ${creator.id}`);
    }
  },
});
