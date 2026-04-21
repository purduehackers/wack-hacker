import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import {
  findMediaByDiscordMessageId,
  getOrCreateBatchId,
  hackNightDateKey,
  snowflakeToDate,
  uploadMedia,
} from "@/bot/integrations/payload";
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

    // Key the batch off the thread's creation timestamp, not `now`, so a
    // late upload still attaches to the right Friday.
    const threadDate = snowflakeToDate(channel.id);
    const dateKey = hackNightDateKey(threadDate);

    // Skip if this Discord message already has media uploaded.
    const existing = await findMediaByDiscordMessageId(messageId);
    if (existing.totalDocs >= imageAttachments.length) return;

    const batchId = await getOrCreateBatchId(dateKey);

    for (const attachment of imageAttachments) {
      try {
        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const filename = `${messageId}-${attachment.filename}`;
        await uploadMedia({
          buffer,
          filename,
          contentType: attachment.contentType ?? "image/jpeg",
          alt: `Hack Night photo from ${author.username}`,
          batchId,
          discordMessageId: messageId,
          discordUserId: author.id,
          source: "hack-night",
        });
        await ctx.discord.channels.addMessageReaction(channel.id, messageId, "\u2705");
      } catch (err) {
        log.warn("hack-night", `Failed to upload ${attachment.filename}: ${String(err)}`);
        await ctx.discord.channels.addMessageReaction(channel.id, messageId, "\u274C");
      }
    }
  },
});
