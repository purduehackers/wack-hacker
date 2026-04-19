import type { MessageCreatePacketType } from "@/lib/protocol/types";

type MessageData = MessageCreatePacketType["data"];

/**
 * True when the bot is @-mentioned at the start of the message. Combines two
 * signals: Discord's native `mentions` array (filters out literal `<@id>` text
 * that isn't actually pinging anyone) and a content-position check (preserves
 * the "only trigger when the mention leads the message" rule).
 *
 * Discord emits mentions as `<@id>` or `<@!id>` (nickname form, older clients).
 */
export function isBotMention(data: MessageData, botUserId: string): boolean {
  if (!data.mentions.includes(botUserId)) return false;
  return data.content.startsWith(`<@${botUserId}>`) || data.content.startsWith(`<@!${botUserId}>`);
}

/**
 * True when a thread message is a reply to a bot-authored message. Replies
 * outside threads don't count — the thread scope is what distinguishes
 * "continuing a conversation with the bot" from "quoting the bot at someone
 * else in a busy channel".
 */
export function isReplyToBot(data: MessageData, botUserId: string): boolean {
  return Boolean(data.thread && data.reference?.authorId === botUserId);
}

export function stripBotMention(content: string, botUserId: string): string {
  // Discord user IDs are numeric snowflakes, so embedding `botUserId` in a
  // regex source is safe — no characters need escaping.
  const match = content.match(new RegExp(`^<@!?${botUserId}>`));
  return match ? content.slice(match[0].length).trim() : content;
}
