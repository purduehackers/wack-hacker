import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { generateEventSlug } from "@/bot/integrations/hack-night";
import { R2Storage } from "@/bot/integrations/r2";
import { env } from "@/env";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const THREAD_NAME_PREFIX = "Hack Night Images";

export const hackNightUpload = defineEvent({
  type: "message",
  async handle(packet, ctx) {
    const { id: messageId, author, channel, attachments, thread } = packet.data;

    if (author.bot) return;
    if (!thread || thread.parentId !== DISCORD_IDS.channels.HACK_NIGHT) return;
    if (!channel.name.startsWith(THREAD_NAME_PREFIX)) return;

    const imageAttachments = attachments.filter((a) => a.contentType?.startsWith("image/"));
    if (imageAttachments.length === 0) return;

    const r2 = new R2Storage(
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.EVENTS_R2_BUCKET_NAME,
    );
    const slug = generateEventSlug(new Date());

    // Skip if this message's images were already uploaded
    const index = await r2.getEventIndex(slug);
    if (index?.images.some((img) => img.discordMessageId === messageId)) return;

    for (const attachment of imageAttachments) {
      try {
        const buffer = await r2.downloadBuffer(attachment.url);
        const filename = `${messageId}-${attachment.filename}`;
        await r2.uploadBuffer(
          `images/${slug}/${filename}`,
          buffer,
          attachment.contentType ?? "image/jpeg",
        );

        await r2.updateEventIndex(slug, {
          filename,
          uploadedAt: new Date().toISOString(),
          discordMessageId: messageId,
          discordUserId: author.id,
        });

        await ctx.discord.channels.addMessageReaction(channel.id, messageId, "\u2705");
      } catch (err) {
        log.warn("hack-night", `Failed to upload ${attachment.filename}: ${String(err)}`);
        await ctx.discord.channels.addMessageReaction(channel.id, messageId, "\u274C");
      }
    }
  },
});
