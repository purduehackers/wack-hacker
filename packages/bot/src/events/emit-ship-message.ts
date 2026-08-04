/**
 * Mirrors `#ship` posts to the public gallery at ships.purduehackers.com.
 *
 * Two handlers, kept together because they are the two halves of one behaviour:
 * a post creates a ship, and deleting that post removes it. Splitting them
 * across files would make it easy to change one and forget the other.
 *
 * Forwarded snapshots are folded into the content and attachment list for the
 * same reason as in `auto-thread`: a forwarded post carries its work in the
 * snapshot, and reading only the message body would mirror an empty ship.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { Result } from "@repo/shared/result";
import type { Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import type { ShipAttachmentInput, ShipsClient } from "../integrations/ships.ts";

const URL_PATTERN = /https?:\/\/\S+/i;

/** The gallery truncates titles; do it here so the ellipsis is ours. */
const MAX_TITLE_CHARS = 100;

/** Discord's default avatars, indexed by the user's snowflake. */
const DEFAULT_AVATAR_COUNT = 6;

function isMedia(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  return contentType.startsWith("image/") || contentType.startsWith("video/");
}

/** Message content plus any forwarded snapshot content, in order. */
export function shipContent(message: Message): string {
  const sections = [message.content];
  for (const snapshot of message.messageSnapshots.values()) {
    if (snapshot.content !== undefined && snapshot.content !== "") sections.push(snapshot.content);
  }
  return sections.filter((section) => section !== "").join("\n");
}

export function shipAttachments(message: Message): readonly ShipAttachmentInput[] {
  const collected: ShipAttachmentInput[] = [];

  const add = (attachment: {
    url: string;
    contentType: string | null;
    name: string;
    width: number | null;
    height: number | null;
  }): void => {
    const type = attachment.contentType ?? undefined;
    if (!isMedia(type)) return;

    collected.push({
      sourceUrl: attachment.url,
      type: type ?? "application/octet-stream",
      filename: attachment.name,
      ...(attachment.width === null ? {} : { width: attachment.width }),
      ...(attachment.height === null ? {} : { height: attachment.height }),
    });
  };

  for (const attachment of message.attachments.values()) add(attachment);
  for (const snapshot of message.messageSnapshots.values()) {
    for (const attachment of snapshot.attachments.values()) add(attachment);
  }

  return collected;
}

/** First line, truncated. `undefined` when the post is media with no text. */
export function shipTitle(content: string): string | undefined {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  if (firstLine === "") return undefined;
  return firstLine.length > MAX_TITLE_CHARS
    ? `${firstLine.slice(0, MAX_TITLE_CHARS)}...`
    : firstLine;
}

export function avatarUrlFor(userId: string, avatarHash: string | null): string {
  if (avatarHash !== null) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`;
  }
  // Discord's own fallback: the snowflake's timestamp bits pick the colour.
  const index = Number(BigInt(userId) >> 22n) % DEFAULT_AVATAR_COUNT;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function emitShipMessage(ships: ShipsClient) {
  return defineEvent({
    name: "emit-ship-message",
    kind: "message",
    dedupKey: (message) => message.id,
    handle: async (message) => {
      if (message.channelId !== DISCORD_IDS.channels.SHIP) return Result.ok(undefined);

      const content = shipContent(message);
      const attachments = shipAttachments(message);
      // Nothing to show: `auto-thread` will have removed it anyway.
      if (!URL_PATTERN.test(content) && attachments.length === 0) return Result.ok(undefined);

      const created = await ships.createShip({
        userId: message.author.id,
        username: message.member?.displayName ?? message.author.username,
        avatarUrl: avatarUrlFor(message.author.id, message.author.avatar),
        messageId: message.id,
        title: shipTitle(content),
        content,
        attachments,
      });

      return Result.map(created, () => undefined);
    },
  });
}

export function deleteShipMessage(ships: ShipsClient) {
  return defineEvent({
    name: "delete-ship-message",
    kind: "messageDelete",
    dedupKey: (message) => message.id,
    handle: async (message) => {
      if (message.channelId !== DISCORD_IDS.channels.SHIP) return Result.ok(undefined);

      // A 404 comes back as `deleted: false` rather than an error: most
      // deletions in #ship are of posts that were never mirrored.
      const removed = await ships.deleteShipByMessageId(message.id);
      return Result.map(removed, () => undefined);
    },
  });
}
