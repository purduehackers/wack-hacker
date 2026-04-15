import type { API } from "@discordjs/core/http-only";
import { log } from "evlog";
import { start, resumeHook } from "workflow/api";

import type { HandlerContext } from "@/bot/types";
import type { RecentMessage } from "@/lib/ai/types";
import type { MessageCreatePacketType } from "@/lib/protocol/types";

import { stripBotMention } from "@/bot/mention";
import { AgentContext } from "@/lib/ai/context";
import { chatWorkflow } from "@/workflows/chat";

const MAX_RECENT_MESSAGES = 15;
const MAX_TOTAL_CHARS = 4000;

async function fetchRecentMessages(
  discord: API,
  channelId: string,
  beforeMessageId: string,
  botUserId: string,
): Promise<RecentMessage[] | undefined> {
  try {
    const raw = await discord.channels.getMessages(channelId, {
      before: beforeMessageId,
      limit: MAX_RECENT_MESSAGES,
    });

    // Discord returns newest-first; filter and keep chronological order
    const filtered = raw
      .filter((m) => m.author.id !== botUserId && m.content?.trim())
      .reverse();

    // Prioritize newest messages within the char budget
    const messages: RecentMessage[] = [];
    let totalChars = 0;

    for (let i = filtered.length - 1; i >= 0; i--) {
      const m = filtered[i];
      if (totalChars + m.content.length > MAX_TOTAL_CHARS) break;
      totalChars += m.content.length;
      messages.unshift({
        author: (m.author as any).global_name ?? m.author.username,
        content: m.content,
        timestamp: new Date(m.timestamp).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }

    return messages.length > 0 ? messages : undefined;
  } catch (err) {
    log.warn("mention", `Failed to fetch recent messages: ${String(err)}`);
    return undefined;
  }
}

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
      await resumeHook(existing.workflowRunId, {
        type: "message" as const,
        content,
        authorId: data.author.id,
        authorUsername: data.author.username,
      });
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
      log.info("mention", `Created thread ${thread.id} for ${data.author.username}`);
    } catch (err) {
      log.warn("mention", `Failed to create thread, replying in channel: ${String(err)}`);
    }
  }

  const agentContext = AgentContext.fromPacket(packet);

  const recentMessages = await fetchRecentMessages(
    ctx.discord,
    sourceChannelId,
    data.id,
    ctx.botUserId,
  );

  log.info("mention", `Starting workflow for ${data.author.username} in ${data.channel.name}`);

  const run = await start(chatWorkflow, [
    {
      channelId: conversationChannelId,
      content,
      context: { ...agentContext.toJSON(), recentMessages },
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
