import type { z } from "zod";

import { log } from "evlog";

import type { MessageCreatePacket } from "@/lib/protocol/packets";

import { defineEvent } from "@/bot/events/define";
import { R2Storage } from "@/bot/integrations/r2";
import { ShipDatabase } from "@/bot/integrations/ships";
import { env } from "@/env";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const URL_PATTERN = /https?:\/\/\S+/i;

type MessageData = z.infer<typeof MessageCreatePacket>["data"];
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

async function uploadMedia(
  r2: R2Storage,
  messageId: string,
  mediaList: Attachment[],
): Promise<
  Array<{ key: string; type: string; filename: string; width?: number; height?: number }>
> {
  const uploaded: Array<{
    key: string;
    type: string;
    filename: string;
    width?: number;
    height?: number;
  }> = [];

  for (const item of mediaList) {
    if (!isMedia(item.contentType)) continue;

    try {
      const buffer = await r2.downloadBuffer(item.url);
      const defaultName = item.contentType?.startsWith("video/") ? "video.mp4" : "image.jpg";
      const fname = `${messageId}-${item.filename ?? defaultName}`;
      const key = `images/ships/${fname}`;
      await r2.uploadBuffer(key, buffer, item.contentType ?? "application/octet-stream");
      uploaded.push({
        key,
        type: item.contentType ?? "application/octet-stream",
        filename: item.filename ?? defaultName,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
      });
    } catch (err) {
      log.warn("ship-scraper", `Failed to upload ${item.filename}: ${String(err)}`);
    }
  }

  return uploaded;
}

export const shipScraper = defineEvent({
  type: "message",
  async handle(packet) {
    const { id: messageId, author, channel } = packet.data;

    if (author.bot) return;
    if (channel.id !== DISCORD_IDS.channels.SHIP) return;

    const { content, attachments } = collectFromSnapshots(packet.data);

    if (!URL_PATTERN.test(content) && attachments.length === 0) return;

    const r2 = new R2Storage(
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.SHIP_R2_BUCKET_NAME,
    );
    const shipDb = new ShipDatabase(
      env.SHIP_DATABASE_TURSO_DATABASE_URL,
      env.SHIP_DATABASE_TURSO_AUTH_TOKEN,
    );

    const uploadedAttachments = await uploadMedia(r2, messageId, attachments);

    const firstLine = content.split("\n")[0]?.trim() ?? "";
    const title = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine || null;
    const nickname = author.nickname ?? author.username;

    try {
      await shipDb.insertShip({
        userId: author.id,
        username: nickname,
        avatarUrl: author.avatarHash
          ? `https://cdn.discordapp.com/avatars/${author.id}/${author.avatarHash}.png?size=128`
          : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(author.id) >> 22n) % 6}.png`,
        messageId,
        title,
        content,
        attachments: uploadedAttachments,
      });
      log.info(
        "ship-scraper",
        `Stored ship ${messageId} from ${nickname} (${uploadedAttachments.length} images)`,
      );
    } catch (err) {
      log.warn("ship-scraper", `Failed to store ship: ${String(err)}`);
    }
  },
});
