import { sliceText } from "@repo/shared/text";
import { MAX_ATTACHMENTS, MAX_CONTENT_CHARS, type MessagePayload } from "@repo/shared/wire";
import type { Attachment, Message } from "discord.js";

type ReplyTo = NonNullable<MessagePayload["replyTo"]>;

type ReplyMessage = Pick<Message, "id" | "channelId" | "content" | "createdAt"> & {
  readonly attachments: ReadonlyMap<
    string,
    Pick<Attachment, "url" | "name" | "size" | "contentType">
  >;
  readonly author: Pick<Message["author"], "id" | "globalName" | "username" | "bot">;
  readonly reference?: Message["reference"];
};

interface ReplySource extends Pick<ReplyMessage, "channelId" | "reference"> {
  readonly channel: {
    readonly messages: { fetch(messageId: string): Promise<ReplyMessage> };
  };
}

export function attachmentsOf(
  message: Pick<ReplyMessage, "attachments">,
): NonNullable<MessagePayload["attachments"]> {
  return [...message.attachments.values()].slice(0, MAX_ATTACHMENTS).map((attachment) => {
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

/** Fetch only the reply target; retain its IDs when the snapshot is unavailable. */
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
