/**
 * Detecting when someone addresses the bot.
 *
 * Both checks are deliberately narrow. Being generous here means the agent wakes
 * up for messages nobody aimed at it, which costs tokens and is confusing in a
 * busy channel.
 */

import type { Message } from "discord.js";

/**
 * True when the bot is @-mentioned *at the start* of the message.
 *
 * Two signals combined. Discord's own `mentions` collection excludes literal
 * `<@id>` text that is not actually pinging anyone. A content-position check
 * preserves the rule that a mention has to lead the message. `<@id>` and
 * `<@!id>` are both emitted — the second is the older nickname form.
 */
export function isBotMention(message: Message, botUserId: string): boolean {
  if (!message.mentions.users.has(botUserId)) return false;
  return (
    message.content.startsWith(`<@${botUserId}>`) || message.content.startsWith(`<@!${botUserId}>`)
  );
}

/**
 * True when a *thread* message replies to something the bot said.
 *
 * The thread scope is what distinguishes continuing a conversation with the bot
 * from quoting the bot at someone else in a busy channel.
 */
export function isReplyToBot(message: Message, botUserId: string): boolean {
  if (!message.channel.isThread()) return false;
  return message.reference !== undefined && message.mentions.repliedUser?.id === botUserId;
}

/** Removes the leading bot mention, leaving the actual request. */
export function stripBotMention(content: string, botUserId: string): string {
  // Discord ids are numeric snowflakes, so interpolating one into a regex needs
  // no escaping.
  const match = content.match(new RegExp(`^<@!?${botUserId}>`));
  return match ? content.slice(match[0].length).trim() : content;
}
