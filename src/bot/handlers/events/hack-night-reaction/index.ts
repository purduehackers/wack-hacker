import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { deleteMedia, findMediaByDiscordMessageId } from "@/bot/integrations/payload";
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

    const found = await findMediaByDiscordMessageId(messageId);
    if (found.totalDocs === 0) return;

    for (const doc of found.docs) {
      try {
        await deleteMedia(doc.id);
      } catch (err) {
        log.warn("hack-night", `Failed to delete media ${doc.id}: ${String(err)}`);
      }
    }

    await ctx.discord.channels.deleteOwnMessageReaction(channelId, messageId, "\u2705");
    log.info(
      "hack-night",
      `Removed ${found.totalDocs} media for message ${messageId} by ${creator.id}`,
    );
  },
});
