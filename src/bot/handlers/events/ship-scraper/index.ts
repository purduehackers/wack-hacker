import type { z } from "zod";

import { put } from "@vercel/blob";
import { log } from "evlog";

import type { MessageCreatePacket } from "@/lib/protocol/packets";

import { defineEvent } from "@/bot/events/define";
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

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadMedia(
  token: string,
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
      const buffer = await downloadBuffer(item.url);
      const defaultName = item.contentType?.startsWith("video/") ? "video.mp4" : "image.jpg";
      const fname = `${messageId}-${item.filename ?? defaultName}`;
      const key = `images/ships/${fname}`;
      const contentType = item.contentType ?? "application/octet-stream";
      await put(key, buffer, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType,
        token,
      });
      uploaded.push({
        key,
        type: contentType,
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

    const shipDb = new ShipDatabase(
      env.SHIP_DATABASE_TURSO_DATABASE_URL,
      env.SHIP_DATABASE_TURSO_AUTH_TOKEN,
    );

    const uploadedAttachments = await uploadMedia(
      env.SHIP_BLOB_READ_WRITE_TOKEN,
      messageId,
      attachments,
    );

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
