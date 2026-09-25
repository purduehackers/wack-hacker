import type { Message } from "discord.js";

/** Direct text plus any forwarded snapshot text, in order. */
export function postContent(message: Message): string {
  const sections = [message.content];
  for (const snapshot of message.messageSnapshots.values()) {
    if (snapshot.content) sections.push(snapshot.content);
  }
  return sections.filter((value) => value !== "").join("\n");
}

export function postTextWithoutUrls(content: string): string {
  return content.replace(/https?:\/\/\S+/giu, " ");
}
