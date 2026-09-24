/**
 * `#ship` and `#checkpoints` housekeeping.
 *
 * Two jobs in one handler, because both hinge on the same question — does this
 * message actually show work?
 *
 * 1. **Enforcement.** A post with no URL and no attachment is deleted. Ships
 *    also need more than five words explaining the work. The author gets a DM
 *    explaining the problem and a copy of any text. Forwarded message
 *    snapshots are inspected too, since a forward carries its evidence in the
 *    snapshot rather than the message body — miss that and legitimate forwards
 *    get deleted.
 * 2. **Threading.** A compliant post gets a thread, so replies do not bury the
 *    next person's work. Every ship and checkpoint gets three reactions chosen
 *    from its text; the WACKY role still unlocks a celebration reply.
 *
 * The DM is best-effort: a user with DMs closed still gets their message
 * removed, because the channel rule matters more than the courtesy copy. That is
 * carried over deliberately — the alternative leaves non-compliant posts up
 * based on a stranger's privacy settings.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Message } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import { postContent } from "../utils/post-content.ts";
import { shipPostIssue } from "../utils/ship-post.ts";
import type { ShipPostIssue } from "../utils/ship-post.ts";
import { selectPostEmojis } from "./post-emojis.ts";

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

const WATCHED_CHANNELS: readonly string[] = [
  DISCORD_IDS.channels.SHIP,
  DISCORD_IDS.channels.CHECKPOINTS,
];

/** Discord's longest auto-archive window, in minutes: three days. */
const AUTO_ARCHIVE_MINUTES = 4_320;

/** Thread names are capped at 100; 54 leaves room for the author prefix. */
const THREAD_TITLE_CHARS = 54;

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

type PostIssue = "missing-evidence" | ShipPostIssue;

const REMOVAL_DETAILS = {
  "missing-evidence": {
    reason: "It needs an attachment or URL so people can see your work.",
    fix: "If you meant to ship or post a checkpoint, add an attachment or URL when you repost.",
  },
  "attachment-only": {
    reason: "An attachment alone does not explain what you shipped.",
    fix: "Repost your attachments with at least six words about what you made or changed. You'll need to attach the files again.",
  },
  "short-explanation": {
    reason: "Your ship explanation needs more than five words.",
    fix: "Repost with at least six words about what you made or changed. URLs do not count as words.",
  },
};

function removalNotice(channelId: string, content: string, issue: PostIssue): string {
  const { reason, fix } = REMOVAL_DETAILS[issue];
  const savedText =
    content.trim() === ""
      ? ""
      : `I saved your text for you! \u{1F643}\u{200D}\u{2195}\u{FE0F}\n\n\`\`\`${content}\`\`\`\n\n`;
  return (
    `Hey there, I removed your post in <#${channelId}>. ${reason}\n\n` +
    savedText +
    `- If you meant to reply to someone, send your message in the corresponding thread!\n` +
    `- ${fix}\n\n` +
    `Cheers! ^•^`
  );
}

export const autoThread = defineEvent({
  name: "auto-thread",
  kind: "message",
  // Deleting or threading twice would be visible, and a RESUME can replay.
  dedupKey: (message) => message.id,
  handle: async (message, context) => {
    if (context.isBotMention) return Result.ok(undefined);
    if (!WATCHED_CHANNELS.includes(message.channelId)) return Result.ok(undefined);

    const postText = postContent(message);
    let issue: PostIssue | undefined;
    if (!showsWork(message)) issue = "missing-evidence";
    else if (message.channelId === DISCORD_IDS.channels.SHIP) issue = shipPostIssue(postText);

    if (issue !== undefined) {
      return Result.tryPromise({
        try: async () => {
          const author = message.author;
          await message.delete();

          // Best effort. A closed DM must not leave the post standing.
          try {
            await author.send(removalNotice(message.channelId, postText, issue));
          } catch (cause) {
            console.warn(`could not DM ${author.id} about removed post`, cause);
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

        const reactions = selectPostEmojis(postText);
        // Sequential awaits preserve reaction order in Discord.
        for (const emoji of reactions) await message.react(emoji);

        if (message.member?.roles.cache.has(DISCORD_IDS.roles.WACKY)) {
          const responseOptions =
            message.channelId === DISCORD_IDS.channels.SHIP ? SHIP_RESPONSES : CHECKPOINT_RESPONSES;
          const chosenReply = responseOptions[Math.floor(Math.random() * responseOptions.length)];
          if (chosenReply !== undefined) await thread.send(`${chosenReply} ${reactions.join(" ")}`);
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
