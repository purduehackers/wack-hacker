import type { DeliveryPayload } from "@repo/shared/wire";
import type { UserContent } from "ai";

function contextBlock(name: string, json: string): string {
  const escaped = json.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  return `<${name}>\n${escaped}\n</${name}>`;
}

/** Keep quoted evidence in this turn; Eve's `context` would make it a separate user message. */
export function discordMessageContent(payload: DeliveryPayload): UserContent {
  let text = contextBlock(
    "current_request",
    JSON.stringify({
      kind: payload.kind,
      messageId: payload.messageId,
      authorId: payload.principal.userId,
      authorName: payload.principal.nickname,
      channelId: payload.channel.id,
      threadId: payload.thread?.id,
      content: payload.content,
    }),
  );
  if (payload.replyTo !== undefined) {
    const quoted = contextBlock(
      "quoted_discord_context",
      JSON.stringify({ replyTo: payload.replyTo }),
    );
    text = `${quoted}\n\n${text}`;
  }

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
