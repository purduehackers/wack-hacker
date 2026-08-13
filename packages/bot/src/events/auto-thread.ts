/**
 * `#ship` and `#checkpoints` housekeeping.
 *
 * Two jobs in one handler, because both hinge on the same question — does this
 * message actually show work?
 *
 * 1. **Enforcement.** A post with no URL and no attachment is deleted, and the
 *    author is DM'd their text back so nothing is lost. Forwarded message
 *    snapshots are inspected too, since a forward carries its evidence in the
 *    snapshot rather than the message body — miss that and legitimate forwards
 *    get deleted.
 * 2. **Threading.** A compliant post gets a thread, so replies do not bury the
 *    next person's work. Authors holding the WACKY role also get reactions and a
 *    celebration message.
 *
 * The DM is best-effort: a user with DMs closed still gets their message
 * removed, because the channel rule matters more than the courtesy copy. That is
 * carried over deliberately — the alternative leaves non-compliant posts up
 * based on a stranger's privacy settings.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { AnyThreadChannel, Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";

const URL_PATTERN = /https?:\/\/\S+/i;

const CHECKPOINT_RESPONSES = [
  "Great checkpoint! :D",
  "Nice progress! :D",
  "Awesome update! :D",
  "Yay thanks for sharing! :D",
  "Yippie!! Keep it up! :D",
  "Who up checking they point?",
] as const;

const SHIP_RESPONSES = [
  "Congrats on shipping! :D",
  "You shipped it! :D",
  "That's a wrap! :D",
  "Yay thanks for sharing! :D",
  "Yippie!! Great work! :D",
  "Launched and loved! :D",
  "Woohoo, it's live now! :D",
  "Done and dusted! :D",
  "High-five on the ship! :D",
  "Boom, nice ship! :D",
] as const;

const CHECKPOINT_EMOJIS = ["\u{1F389}", "\u2728", "\u{1F3C1}"] as const;
const SHIP_EMOJIS = ["\u{1F389}", "\u2728", "\u{1F680}"] as const;

const WATCHED_CHANNELS: readonly string[] = [
  DISCORD_IDS.channels.SHIP,
  DISCORD_IDS.channels.CHECKPOINTS,
];

/** Discord's longest auto-archive window, in minutes: three days. */
const AUTO_ARCHIVE_MINUTES = 4_320;

/** Thread names are capped at 100; 54 leaves room for the author prefix. */
const THREAD_TITLE_CHARS = 54;

function randomItem<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Whether the message shows work.
 *
 * The forwarded-snapshot case is the subtle part: a forwarded message keeps its
 * URL and attachments in the snapshot, so checking only the body would delete
 * legitimate forwards.
 */
function showsWork(message: Message): boolean {
  if (URL_PATTERN.test(message.content)) return true;
  if (message.attachments.size > 0) return true;

  for (const snapshot of message.messageSnapshots.values()) {
    if (snapshot.content !== undefined && URL_PATTERN.test(snapshot.content)) return true;
    if (snapshot.attachments.size > 0) return true;
  }

  return false;
}

/** The text DM'd back so a deleted post is never simply lost. */
function savedMessageNotice(channelId: string, content: string): string {
  return (
    `Hey there, it looks like you tried to send a message in <#${channelId}> without an attachment or URL!! D:\n\n` +
    `It's okay!! I saved your message for you!! \u{1F643}\u{200D}\u{2195}\u{FE0F}\n\n` +
    `\`\`\`${content}\`\`\`\n\n` +
    `- If you meant to reply to someone, send your message in the corresponding thread!\n` +
    `- If you meant checkpoint or ship a project, add an attachment or URL so people can see your work :D\n\n` +
    `Cheers! ^•^`
  );
}

async function celebrate(
  message: Message,
  thread: AnyThreadChannel,
  responses: readonly string[],
  emojis: readonly string[],
): Promise<void> {
  // Sequential, not concurrent: Discord orders reactions by arrival, and
  // Promise.all would scramble them.
  for (const glyph of emojis) await message.react(glyph);

  const chosen = randomItem(responses);
  if (chosen !== undefined) await thread.send(`${chosen} ${emojis.join(" ")}`);
}

export const autoThread = defineEvent({
  name: "auto-thread",
  kind: "message",
  // Deleting or threading twice would be visible, and a RESUME can replay.
  dedupKey: (message) => message.id,
  handle: async (message, context) => {
    if (context.isBotMention) return Result.ok(undefined);
    if (!WATCHED_CHANNELS.includes(message.channelId)) return Result.ok(undefined);

    if (!showsWork(message)) {
      return Result.tryPromise({
        try: async () => {
          const { content } = message;
          const author = message.author;
          await message.delete();

          // Best effort. A closed DM must not leave the post standing.
          try {
            await author.send(savedMessageNotice(message.channelId, content));
          } catch (cause) {
            console.warn(`could not DM ${author.id} their saved message`, cause);
          }
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "remove non-compliant message",
            detail: messageOf(cause),
          }),
      });
    }

    return Result.tryPromise({
      try: async () => {
        const nickname = message.member?.displayName ?? message.author.username;
        const thread = await message.startThread({
          name: `${nickname} - ${message.content.slice(0, THREAD_TITLE_CHARS)}`,
          autoArchiveDuration: AUTO_ARCHIVE_MINUTES,
        });

        if (!message.member?.roles.cache.has(DISCORD_IDS.roles.WACKY)) return undefined;

        if (message.channelId === DISCORD_IDS.channels.CHECKPOINTS) {
          await celebrate(message, thread, CHECKPOINT_RESPONSES, CHECKPOINT_EMOJIS);
        } else if (message.channelId === DISCORD_IDS.channels.SHIP) {
          await celebrate(message, thread, SHIP_RESPONSES, SHIP_EMOJIS);
        }
        return undefined;
      },
      catch: (cause) =>
        new Transient({
          operation: "auto-thread message",
          detail: messageOf(cause),
        }),
    });
  },
});
