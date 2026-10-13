/** Explicit references carried by a Discord turn. Ambient channel history stays out. */

import { sliceText } from "@repo/shared/text";
import { MAX_CONTENT_CHARS, type MessagePayload } from "@repo/shared/wire";
import type { Attachment, Message } from "discord.js";

type ReplyTo = NonNullable<MessagePayload["replyTo"]>;

interface WithAttachments {
  readonly attachments: {
    values(): IterableIterator<Pick<Attachment, "url" | "name" | "size" | "contentType">>;
  };
}

interface ReferencedMessage extends WithAttachments {
  readonly id: string;
  readonly channelId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly author: Pick<Message["author"], "id" | "globalName" | "username" | "bot">;
  readonly reference?: Message["reference"];
}

interface ReplySource {
  readonly channelId: string;
  readonly reference?: Message["reference"];
  readonly channel: {
    readonly messages: { fetch(messageId: string): Promise<ReferencedMessage> };
  };
}

export function attachmentsOf(
  message: WithAttachments,
): NonNullable<MessagePayload["attachments"]> {
  return [...message.attachments.values()].slice(0, 10).map((attachment) => {
    const contentType = attachment.contentType ?? undefined;
    return {
      url: attachment.url,
      filename: attachment.name,
      size: attachment.size,
      ...(contentType === undefined ? {} : { contentType }),
    };
  });
}

function referenceOf(message: Pick<ReplySource, "reference" | "channelId">): ReplyTo | undefined {
  const reference = message.reference;
  if (reference?.messageId === undefined) return undefined;
  return {
    messageId: reference.messageId,
    channelId: reference.channelId ?? message.channelId,
  };
}

/**
 * Runs for each addressed message, never just session creation. Fetch exactly the
 * reply target, without nearby chatter or recursive reply expansion. A failed or
 * cross-channel lookup keeps the reference so the model can request it if needed.
 */
export async function fetchReplyTo(message: ReplySource): Promise<ReplyTo | undefined> {
  const reference = referenceOf(message);
  if (reference === undefined || reference.channelId !== message.channelId) return reference;

  try {
    const target = await message.channel.messages.fetch(reference.messageId);
    if (target.id !== reference.messageId || target.channelId !== reference.channelId)
      return reference;
    const replyTo = referenceOf(target);
    return {
      ...reference,
      snapshot: {
        authorId: target.author.id,
        authorName: target.author.globalName ?? target.author.username,
        isBot: target.author.bot,
        createdAt: target.createdAt.toISOString(),
        content: sliceText(target.content, MAX_CONTENT_CHARS),
        truncated: target.content.length > MAX_CONTENT_CHARS,
        attachments: attachmentsOf(target),
        ...(replyTo === undefined ? {} : { replyTo }),
      },
    };
  } catch {
    return reference;
  }
}
