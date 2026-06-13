import { resumeHook } from "workflow/api";

import type { ChatHookEvent } from "@/workflows/chat";

import { defineEvent } from "@/bot/events/define";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";

/**
 * ✅ on one of the bot's replies ends the conversation gracefully: the chat
 * workflow's hook loop receives `{type: "done"}`, runs cleanup (conversation
 * key, snapshot, sandbox), and emits its terminal wide event — instead of
 * idling out an hour later. Restricted to bot-authored messages so a stray ✅
 * on someone's message in the thread doesn't kill the conversation.
 */
export const conversationDone = defineEvent({
  type: "reactionAdd",
  async handle(packet, ctx) {
    if (packet.data.emoji.name !== "\u2705") return;
    const { messageId, channelId, creator } = packet.data;
    // The bot adds ✅ reactions itself (e.g. hack-night uploads); ignore them.
    if (creator.id === ctx.botUserId) return;

    const existing = await ctx.store.get(channelId);
    if (!existing) return;

    const message = await ctx.discord.channels.getMessage(channelId, messageId);
    if (message.author?.id !== ctx.botUserId) return;

    const logger = createWideLogger({
      op: "chat.done_reaction",
      chat: { id: existing.workflowRunId, channel_id: channelId, user_id: creator.id },
    });
    try {
      const event: ChatHookEvent = { type: "done" };
      await resumeHook(existing.workflowRunId, event);
      countMetric("chat.done_reaction.ok");
      logger.emit({ outcome: "ok" });
    } catch (err) {
      // The run already ended (expired or cleaned up) — drop the stale key so
      // the next mention starts fresh.
      countMetric("chat.done_reaction.ended");
      await ctx.store.delete(channelId);
      logger.warn("workflow already ended", { reason: String(err) });
      logger.emit({ outcome: "ended" });
    }
  },
});
