import { log } from "evlog";

import type { HandlerContext } from "@/bot/types";

import { defineEvent } from "@/bot/events/define";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const URL_PATTERN = /https?:\/\/\S+/i;

const CHECKPOINT_RESPONSES = [
  "Great checkpoint! :D",
  "Nice progress! :D",
  "Awesome update! :D",
  "Yay thanks for sharing! :D",
  "Yippie!! Keep it up! :D",
  "Who up checking they point?",
];

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
];

const AUTO_THREAD_CHANNELS: readonly string[] = [
  DISCORD_IDS.channels.SHIP,
  DISCORD_IDS.channels.CHECKPOINTS,
];

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface CelebrationOpts {
  ctx: HandlerContext;
  channelId: string;
  messageId: string;
  threadId: string;
  responses: readonly string[];
  emojis: readonly string[];
}

async function celebrateWacky(opts: CelebrationOpts): Promise<void> {
  await Promise.all(
    opts.emojis.map((e) =>
      opts.ctx.discord.channels.addMessageReaction(opts.channelId, opts.messageId, e),
    ),
  );
  await opts.ctx.discord.channels.createMessage(opts.threadId, {
    content: `${randomItem(opts.responses)} ${opts.emojis.join(" ")}`,
  });
}

export const autoThread = defineEvent({
  type: "message",
  async handle(packet, ctx) {
    const {
      id: messageId,
      author,
      channel,
      content,
      attachments,
      memberRoles,
      forwardedSnapshots,
    } = packet.data;

    if (author.bot) return;
    if (!AUTO_THREAD_CHANNELS.includes(channel.id)) return;

    let hasUrl = URL_PATTERN.test(content);
    let hasAttachment = attachments.length > 0;

    for (const snapshot of forwardedSnapshots ?? []) {
      if (!hasUrl && snapshot.content) hasUrl = URL_PATTERN.test(snapshot.content);
      if (!hasAttachment && snapshot.attachments?.length) hasAttachment = true;
    }

    if (!hasUrl && !hasAttachment) {
      log.info(
        "auto-thread",
        `Deleting non-compliant message ${messageId} from ${author.username}`,
      );
      await ctx.discord.channels.deleteMessage(channel.id, messageId);

      try {
        const dm = await ctx.discord.users.createDM(author.id);
        await ctx.discord.channels.createMessage(dm.id, {
          content:
            `Hey there, it looks like you tried to send a message in <#${channel.id}> without an attachment or URL!! D:\n\n` +
            `It's okay!! I saved your message for you!! \u{1F643}\u{200D}\u{2195}\u{FE0F}\n\n` +
            `\`\`\`${content}\`\`\`\n\n` +
            `- If you meant to reply to someone, send your message in the corresponding thread!\n` +
            `- If you meant checkpoint or ship a project, add an attachment or URL so people can see your work :D\n\n` +
            `Cheers! ^•^`,
        });
      } catch (err) {
        log.warn("auto-thread", `Could not DM user ${author.id}: ${String(err)}`);
      }
      return;
    }

    const nickname = author.nickname ?? author.username;
    const thread = await ctx.discord.channels.createThread(
      channel.id,
      { name: `${nickname} - ${content.slice(0, 54)}`, auto_archive_duration: 4320 },
      messageId,
    );

    if (memberRoles?.includes(DISCORD_IDS.roles.WACKY)) {
      const base = { ctx, channelId: channel.id, messageId, threadId: thread.id };
      if (channel.id === DISCORD_IDS.channels.CHECKPOINTS) {
        await celebrateWacky({
          ...base,
          responses: CHECKPOINT_RESPONSES,
          emojis: ["\u{1F389}", "\u2728", "\u{1F3C1}"],
        });
      } else if (channel.id === DISCORD_IDS.channels.SHIP) {
        await celebrateWacky({
          ...base,
          responses: SHIP_RESPONSES,
          emojis: ["\u{1F389}", "\u2728", "\u{1F680}"],
        });
      }
    }

    await ctx.discord.channels.edit(thread.id, { archived: true, locked: true });
  },
});
