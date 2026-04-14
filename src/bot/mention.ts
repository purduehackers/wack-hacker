/**
 * Discord emits user mentions in two forms:
 *   - `<@id>`  — standard mention
 *   - `<@!id>` — nickname mention (older clients, still seen in historical
 *                messages and some gateway payloads)
 *
 * The bot's at-mention detection has to handle both, otherwise `<@!id>` pings
 * get missed or have the prefix left in the content after "stripping".
 */

export function isBotMention(content: string, botUserId: string): boolean {
  return content.startsWith(`<@${botUserId}>`) || content.startsWith(`<@!${botUserId}>`);
}

export function stripBotMention(content: string, botUserId: string): string {
  // Discord user IDs are numeric snowflakes, so embedding `botUserId` in a
  // regex source is safe — no characters need escaping.
  const match = content.match(new RegExp(`^<@!?${botUserId}>`));
  return match ? content.slice(match[0].length).trim() : content;
}
