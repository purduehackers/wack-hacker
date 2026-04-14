import { log } from "evlog";
import { start, resumeHook } from "workflow/api";

import type { HandlerContext } from "@/bot/types";
import type { MessageCreatePacketType } from "@/lib/protocol/types";

import { stripBotMention } from "@/bot/mention";
import { AgentContext } from "@/lib/ai/context";
import { chatWorkflow } from "@/workflows/chat";

export async function handleMention(
  packet: MessageCreatePacketType,
  ctx: HandlerContext,
): Promise<void> {
  const { data } = packet;
  const channelId = data.channel.id;
  const threadId = data.thread ? data.channel.id : undefined;

  const content = stripBotMention(data.content, ctx.botUserId);

  if (!content) {
    await ctx.discord.channels.createMessage(channelId, {
      content: "Hey! What can I help you with?",
    });
    return;
  }

  const existing = await ctx.store.get(channelId, threadId);

  if (existing) {
    log.info("mention", `Resuming workflow ${existing.workflowRunId} for ${data.author.username}`);
    try {
      await resumeHook(existing.workflowRunId, {
        type: "message" as const,
        content,
        authorId: data.author.id,
        authorUsername: data.author.username,
      });
      await ctx.store.touch(channelId, threadId);
      return;
    } catch (err) {
      log.info(
        "mention",
        `Workflow ${existing.workflowRunId} expired, starting fresh: ${String(err)}`,
      );
      await ctx.store.delete(channelId, threadId);
    }
  }

  const agentContext = AgentContext.fromPacket(packet);

  log.info("mention", `Starting workflow for ${data.author.username} in ${data.channel.name}`);

  const run = await start(chatWorkflow, [
    {
      channelId,
      content,
      context: agentContext.toJSON(),
    },
  ]);

  log.info("mention", `Workflow ${run.runId} started`);

  await ctx.store.set({
    workflowRunId: run.runId,
    channelId,
    threadId,
    startedAt: new Date().toISOString(),
  });
}
