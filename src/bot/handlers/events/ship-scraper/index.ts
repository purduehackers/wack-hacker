import { log } from "evlog";

import type { ShipAttachmentInput } from "@/bot/integrations/ships";
import type { MessageCreatePacketType } from "@/lib/protocol/types";

import { defineEvent } from "@/bot/events/define";
import { ShipsClient } from "@/bot/integrations/ships";
import { env } from "@/env";
import { withSpan } from "@/lib/otel/tracing";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const URL_PATTERN = /https?:\/\/\S+/i;

type MessageData = MessageCreatePacketType["data"];
type Attachment = MessageData["attachments"][number];

function collectFromSnapshots(data: MessageData): {
  content: string;
  attachments: Attachment[];
} {
  let content = data.content;
  const attachments = [...data.attachments];

  for (const snapshot of data.forwardedSnapshots ?? []) {
    if (snapshot.content) content = content ? `${content}\n${snapshot.content}` : snapshot.content;
    if (snapshot.attachments) attachments.push(...snapshot.attachments);
  }

  return { content, attachments };
}

function isMedia(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.startsWith("image/") || contentType.startsWith("video/");
}

function toShipAttachment(item: Attachment): ShipAttachmentInput | null {
  if (!isMedia(item.contentType)) return null;
  const defaultName = item.contentType?.startsWith("video/") ? "video.mp4" : "image.jpg";
  return {
    sourceUrl: item.url,
    type: item.contentType ?? "application/octet-stream",
    filename: item.filename ?? defaultName,
    width: item.width,
    height: item.height,
  };
}

export const shipScraper = defineEvent({
  type: "message",
  async handle(packet) {
    const { id: messageId, author, channel } = packet.data;

    if (author.bot) return;
    if (channel.id !== DISCORD_IDS.channels.SHIP) return;

    const { content, attachments } = collectFromSnapshots(packet.data);

    if (!URL_PATTERN.test(content) && attachments.length === 0) return;

    // Named span for the actual scrape so it's a distinct, labeled child of the
    // discord.event trace rather than anonymous work.
    await withSpan(
      "ship_scraper",
      { "ship.message_id": messageId, "ship.channel_id": channel.id },
      async () => {
        const shipAttachments = attachments
          .map(toShipAttachment)
          .filter((a): a is ShipAttachmentInput => a !== null);

        const firstLine = content.split("\n")[0]?.trim() ?? "";
        const title = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine || null;
        const nickname = author.nickname ?? author.username;
        const avatarUrl = author.avatarHash
          ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatarHash}.png?size=128`
          : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(author.id) >> 22n) % 6}.png`;

        const ships = new ShipsClient(env.SHIP_API_KEY);

        try {
          const result = await ships.createShip({
            userId: author.id,
            username: nickname,
            avatarUrl,
            messageId,
            title,
            content,
            attachments: shipAttachments,
          });
          log.info(
            "ship-scraper",
            `Stored ship ${result.id} from ${nickname} (${shipAttachments.length} attachments${result.alreadyExists ? ", idempotent" : ""})`,
          );
        } catch (err) {
          // Best-effort scrape: a store failure is a warning, not an issue.
          log.warn("ship-scraper", `Failed to store ship: ${String(err)}`);
        }
      },
    );
  },
});
