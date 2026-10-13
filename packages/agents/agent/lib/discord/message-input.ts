import type { DeliveryPayload } from "@repo/shared/wire";
import type { UserContent } from "ai";

/** Escape delimiters as well as JSON control characters in user-authored text. */
function escapeContextDelimiters(json: string): string {
  return json.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

/**
 * One delivered user turn, with a quoted reply target before the current request.
 * Never pass imported Discord messages through Eve's `context` option: each
 * string there becomes a separate durable user turn. Legacy backscroll fields
 * are deliberately ignored, including on deliveries queued before this change.
 */
export function discordMessageContent(payload: DeliveryPayload): string | UserContent {
  const request = escapeContextDelimiters(
    JSON.stringify({
      kind: payload.kind,
      messageId: payload.messageId,
      authorId: payload.principal.userId,
      authorName: payload.principal.nickname,
      channelId: payload.channel.id,
      ...(payload.thread === undefined ? {} : { threadId: payload.thread.id }),
      content: payload.content,
    }),
  );
  const currentRequest = `<current_request>\n${request}\n</current_request>`;
  const text =
    payload.replyTo === undefined
      ? currentRequest
      : `<quoted_discord_context>\n${escapeContextDelimiters(JSON.stringify({ replyTo: payload.replyTo }))}\n</quoted_discord_context>\n\n${currentRequest}`;

  if (payload.attachments === undefined || payload.attachments.length === 0) return text;
  return [
    { type: "text", text },
    ...payload.attachments.map((attachment) => ({
      type: "file" as const,
      data: new URL(attachment.url),
      filename: attachment.filename,
      mediaType: attachment.contentType ?? "application/octet-stream",
    })),
  ];
}
