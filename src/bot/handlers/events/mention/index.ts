import { log } from "evlog";
import { start, resumeHook } from "workflow/api";

import type { HandlerContext } from "@/bot/types";
import type { MessageCreatePacketType } from "@/lib/protocol/types";
import type { ChatHookEvent } from "@/workflows/chat";

import { buildTurnContext } from "@/bot/chat-context";
import { stripBotMention } from "@/bot/mention";
import { chatWorkflow } from "@/workflows/chat";

export async function handleMention(
  packet: MessageCreatePacketType,
  ctx: HandlerContext,
): Promise<void> {
  const { data } = packet;
  const sourceChannelId = data.channel.id;
  const alreadyInThread = Boolean(data.thread);
  const lookupThreadId = alreadyInThread ? sourceChannelId : undefined;

  const content = stripBotMention(data.content, ctx.botUserId);

  if (!content) {
    await ctx.discord.channels.createMessage(sourceChannelId, {
      content: "Hey! What can I help you with?",
    });
    return;
  }

  const existing = await ctx.store.get(sourceChannelId, lookupThreadId);

  if (existing) {
    log.info("mention", `Resuming workflow ${existing.workflowRunId} for ${data.author.username}`);
    try {
      const turnContext = await buildTurnContext(ctx.discord, packet);
      const event: ChatHookEvent = { type: "message", content, context: turnContext };
      await resumeHook(existing.workflowRunId, event);
      await ctx.store.touch(sourceChannelId, lookupThreadId);
      return;
    } catch (err) {
      log.info(
        "mention",
        `Workflow ${existing.workflowRunId} expired, starting fresh: ${String(err)}`,
      );
      await ctx.store.delete(sourceChannelId, lookupThreadId);
    }
  }

  let conversationChannelId = sourceChannelId;
  let conversationThreadId = lookupThreadId;
  let createdThread: { id: string; name: string } | undefined;

  if (!alreadyInThread) {
    try {
      const threadName =
        `${data.author.nickname ?? data.author.username} — ${content.slice(0, 54)}`.trim();
      const thread = await ctx.discord.channels.createThread(
        sourceChannelId,
        { name: threadName, auto_archive_duration: 60 },
        data.id,
      );
      conversationChannelId = thread.id;
      conversationThreadId = thread.id;
      createdThread = { id: thread.id, name: thread.name };
      log.info("mention", `Created thread ${thread.id} for ${data.author.username}`);
    } catch (err) {
      log.warn("mention", `Failed to create thread, replying in channel: ${String(err)}`);
    }
  }

  const turnContext = await buildTurnContext(ctx.discord, packet, createdThread);

  log.info("mention", `Starting workflow for ${data.author.username} in ${data.channel.name}`);

  const run = await start(chatWorkflow, [
    {
      channelId: conversationChannelId,
      content,
      context: turnContext,
    },
  ]);

  log.info("mention", `Workflow ${run.runId} started`);

  await ctx.store.set({
    workflowRunId: run.runId,
    channelId: sourceChannelId,
    threadId: conversationThreadId,
    startedAt: new Date().toISOString(),
  });
}
