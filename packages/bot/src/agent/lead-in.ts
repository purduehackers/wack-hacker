/**
 * Conversation context gathered before the first turn.
 *
 * When someone @-mentions the bot they are usually continuing a conversation
 * the bot could not see. These fetches give the agent the surrounding messages
 * so it does not answer as though the channel were empty.
 *
 * The bot fetches lead-in **only on the first turn**. The agent pins it for the
 * life of the session. Re-sending it every turn would both waste tokens and
 * break prompt caching by changing bytes the model has already seen.
 * Turn-to-turn memory comes from the durable session instead.
 *
 * Every fetch here is best-effort. Missing context degrades an answer. A thrown
 * error would lose the message entirely, which is much worse.
 */

import type { Message } from "discord.js";

import { TIME_ZONE } from "../utils/dates.ts";

/** Messages of channel backscroll pulled in ahead of the mention. */
const MAX_RECENT_MESSAGES = 15;

/** The reply anchor plus the messages leading up to it. */
const REFERENCED_CONTEXT_SIZE = 15;

/**
 * Per-message cap inside a lead-in block.
 *
 * The agent pins the block for the conversation's lifetime. One pasted wall of
 * text would then cost tokens again on every step of every turn.
 */
const MAX_MESSAGE_CHARS = 300;

function ellipsize(content: string): string {
  if (content.length <= MAX_MESSAGE_CHARS) return content;

  let cut = content.slice(0, MAX_MESSAGE_CHARS - 1);
  // Never split a surrogate pair: a lone high surrogate renders as a replacement
  // character in the prompt.
  const last = cut.codePointAt(cut.length - 1);
  if (last !== undefined && last >= 0xd8_00 && last <= 0xdb_ff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Renders one message as a single prompt line.
 *
 * A string rather than a structured object because each entry crosses the wire
 * as one `context` item. Eve appends each as its own user message. Keeping
 * the shape flat means the model sees a transcript rather than serialized JSON.
 *
 * This function passes the zone explicitly because the process runs in UTC.
 * These lines are the model's only clock for the conversation it joins. An
 * unqualified `toLocaleTimeString` would label evening hack-night backscroll
 * with the next morning's hours and make every time-relative answer wrong.
 */
function renderLeadInLine(message: Message): string {
  const author = message.author.globalName ?? message.author.username;
  const time = message.createdAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
  // Attachment-only and sticker messages arrive with no text. A placeholder
  // keeps the line meaningful instead of ending at a dangling `author:`.
  const body = message.content.trim() === "" ? "(no text content)" : ellipsize(message.content);
  return `${author} (${time}): ${body}`;
}

/**
 * Channel backscroll immediately before the mention, oldest first.
 *
 * Discord returns newest-first, so this function reverses the order — a
 * transcript the model reads backwards is worse than no transcript.
 */
async function fetchRecentMessages(message: Message): Promise<readonly Message[]> {
  try {
    const fetched = await message.channel.messages.fetch({
      before: message.id,
      limit: MAX_RECENT_MESSAGES,
    });

    return [...fetched.values()].filter((candidate) => candidate.content.trim() !== "").reverse();
  } catch {
    return [];
  }
}

/**
 * The replied-to message plus what preceded it, oldest first.
 *
 * Used when a mention replies to older chatter that has already scrolled out of
 * the recent tail. The model can then see both the anchor and how it came up.
 * This function keeps the anchor last even when it has no text, so "last entry
 * is the reply target" always holds.
 */
async function fetchReferencedContext(
  message: Message,
  referencedMessageId: string,
): Promise<readonly Message[]> {
  try {
    const [anchor, priors] = await Promise.all([
      message.channel.messages.fetch(referencedMessageId),
      message.channel.messages.fetch({
        before: referencedMessageId,
        limit: REFERENCED_CONTEXT_SIZE - 1,
      }),
    ]);

    const chronological = [...priors.values()]
      .reverse()
      .filter((candidate) => candidate.content.trim() !== "");

    return [...chronological, anchor];
  } catch {
    return [];
  }
}

interface LeadIn {
  readonly recentMessages: readonly string[];
  readonly referencedContext: readonly string[];
}

/**
 * Both lead-in blocks for a mention, rendered for the wire.
 *
 * Two cases skip the referenced fetch: a reply target in another channel, and
 * one already in the recent tail. That second check is why the fetches above
 * return messages rather than lines — it needs ids. Without it, a reply to
 * something just said would send the same fifteen messages twice.
 */
export async function fetchLeadIn(message: Message): Promise<LeadIn> {
  const recent = await fetchRecentMessages(message);
  const recentMessages = recent.map(renderLeadInLine);
  const none: LeadIn = { recentMessages, referencedContext: [] };

  const replyReference = message.reference;
  if (replyReference?.messageId === undefined) return none;

  const sameChannel =
    replyReference.channelId === undefined || replyReference.channelId === message.channelId;
  if (!sameChannel) return none;

  const referencedId = replyReference.messageId;
  if (recent.some((candidate) => candidate.id === referencedId)) return none;

  const replyContext = await fetchReferencedContext(message, referencedId);
  return { recentMessages, referencedContext: replyContext.map(renderLeadInLine) };
}
