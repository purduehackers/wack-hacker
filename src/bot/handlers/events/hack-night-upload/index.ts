import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { hasHackNightImageForMessage, uploadHackNightImage } from "@/bot/integrations/cms";
import { resolveEventSlug } from "@/bot/integrations/hack-night";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const THREAD_NAME_PREFIX = "Hack Night Images";

export const hackNightUpload = defineEvent({
  type: "message",
  async handle(packet, ctx) {
    const { id: messageId, author, channel, attachments, thread, timestamp } = packet.data;

    if (author.bot) return;
    if (!thread || thread.parentId !== DISCORD_IDS.channels.HACK_NIGHT) return;
    if (!channel.name.startsWith(THREAD_NAME_PREFIX)) return;

    const imageAttachments = attachments.filter((a) => a.contentType?.startsWith("image/"));
    if (imageAttachments.length === 0) return;

    const slug = await resolveEventSlug(channel.id, new Date(timestamp));

    if (await hasHackNightImageForMessage(slug, messageId)) return;

    for (const attachment of imageAttachments) {
      try {
        await uploadHackNightImage({
          url: attachment.url,
          slug,
          discordMessageId: messageId,
          discordUserId: author.id,
          filename: `${messageId}-${attachment.filename}`,
          contentType: attachment.contentType ?? "image/jpeg",
        });
        await ctx.discord.channels.addMessageReaction(channel.id, messageId, "\u2705");
      } catch (err) {
        log.warn("hack-night", `Failed to upload ${attachment.filename}: ${String(err)}`);
        await ctx.discord.channels.addMessageReaction(channel.id, messageId, "\u274C");
      }
    }
  },
});
