import { put } from "@vercel/blob";
import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import {
  generateEventSlug,
  getEventIndex,
  type ImageMetadata,
  updateEventIndex,
} from "@/bot/integrations/hack-night";
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

    const slug = generateEventSlug(new Date());

    // Skip if this message's images were already indexed
    const index = await getEventIndex(slug);
    if (index?.images.some((img) => img.discordMessageId === messageId)) return;

    const token = env.EVENTS_BLOB_READ_WRITE_TOKEN;
    const uploaded: ImageMetadata[] = [];

    for (const attachment of imageAttachments) {
      try {
        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const filename = `${messageId}-${attachment.filename}`;
        await put(`images/${slug}/${filename}`, buffer, {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: attachment.contentType ?? "image/jpeg",
          token,
        });

        uploaded.push({
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

    if (uploaded.length > 0) {
      try {
        await updateEventIndex(slug, uploaded);
      } catch (err) {
        log.warn(
          "hack-night",
          `Failed to index ${uploaded.length} image(s) for ${slug}: ${String(err)}`,
        );
      }
    }
  },
});
