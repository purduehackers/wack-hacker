import type { API } from "@discordjs/core/http-only";

import { start, resumeHook } from "workflow/api";

import type { HandlerContext } from "@/bot/types";
import type { RecentMessage } from "@/lib/ai/types";
import type { MessageCreatePacketType } from "@/lib/protocol/types";
import type { ChatHookEvent } from "@/workflows/chat";

import { stripBotMention } from "@/bot/mention";
import { fetchRecentMessages, fetchReferencedMessageContext } from "@/bot/recent-messages";
import { AgentContext } from "@/lib/ai/context";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";
import { captureTraceparent, setActiveSpanAttributes, withSpan } from "@/lib/otel/tracing";
import { chatWorkflow } from "@/workflows/chat";

type MessageData = MessageCreatePacketType["data"];
type WideLogger = ReturnType<typeof createWideLogger>;

async function fetchLeadInMessages(
  discord: API,
  sourceChannelId: string,
  data: MessageData,
): Promise<{ recentMessages?: RecentMessage[]; referencedContext?: RecentMessage[] }> {
  const recentMessages = await fetchRecentMessages(discord, sourceChannelId, data.id);

  const ref = data.reference;
  if (!ref?.messageId) return { recentMessages };

  const sameChannel = !ref.channelId || ref.channelId === sourceChannelId;
  const alreadyInRecent = recentMessages?.some((m) => m.id === ref.messageId) ?? false;
  if (!sameChannel || alreadyInRecent) return { recentMessages };

  const referencedContext = await fetchReferencedMessageContext(
    discord,
    sourceChannelId,
    ref.messageId,
  );
  return { recentMessages, referencedContext };
}

interface MentionRouting {
  sourceChannelId: string;
  lookupThreadId: string | undefined;
  alreadyInThread: boolean;
}

/**
 * Try to resume an existing chat workflow by replaying the mention as a hook
 * event. Returns `true` on success so the caller can short-circuit. Returns
 * `false` when the workflow has expired; the caller should start fresh.
 */
async function tryResumeExistingWorkflow(args: {
  packet: MessageCreatePacketType;
  ctx: HandlerContext;
  existing: { workflowRunId: string };
  content: string;
  routing: MentionRouting;
  logger: WideLogger;
}): Promise<boolean> {
  const { packet, ctx, existing, content, routing, logger } = args;
  setActiveSpanAttributes({ "chat.id": existing.workflowRunId });
  logger.set({ chat: { id: existing.workflowRunId } });
  try {
    // No recentMessages fetch on resume: the lead-in context was pinned at
    // workflow start; turn-to-turn conversation memory comes from the
    // workflow's accumulated messages array instead.
    const turnContext = AgentContext.fromPacket(packet).toJSON();
    const event: ChatHookEvent = {
      type: "message",
      content,
      context: turnContext,
      traceparent: captureTraceparent(),
    };
    await resumeHook(existing.workflowRunId, event);
    await ctx.store.touch(routing.sourceChannelId, routing.lookupThreadId);
    countMetric("chat.workflow.resumed");
    return true;
  } catch (err) {
    countMetric("chat.workflow.resume_expired");
    logger.warn("resume failed, starting fresh", { reason: String(err) });
    await ctx.store.delete(routing.sourceChannelId, routing.lookupThreadId);
    return false;
  }
}

/**
 * Ensure the conversation has a dedicated thread. If the mention is already
 * inside a thread we reuse it; otherwise we try to open one. A failure to open
 * the thread is non-fatal — the conversation falls back to the source channel.
 */
async function ensureConversationThread(args: {
  ctx: HandlerContext;
  packet: MessageCreatePacketType;
  routing: MentionRouting;
  content: string;
  logger: WideLogger;
}): Promise<{
  conversationChannelId: string;
  conversationThreadId: string | undefined;
  createdThread: { id: string; name: string } | undefined;
}> {
  const { ctx, packet, routing, content, logger } = args;
  const { data } = packet;
  let conversationChannelId = routing.sourceChannelId;
  let conversationThreadId = routing.lookupThreadId;
  let createdThread: { id: string; name: string } | undefined;

  if (!routing.alreadyInThread) {
    try {
      const threadName =
        `${data.author.nickname ?? data.author.username} — ${content.slice(0, 54)}`.trim();
      const thread = await ctx.discord.channels.createThread(
        routing.sourceChannelId,
        { name: threadName, auto_archive_duration: 60 },
        data.id,
      );
      conversationChannelId = thread.id;
      conversationThreadId = thread.id;
      createdThread = { id: thread.id, name: thread.name };
      countMetric("chat.thread.created");
      logger.set({ chat: { thread_id: thread.id } });
    } catch (err) {
      countMetric("chat.thread.create_failed");
      logger.warn("thread create failed", { reason: String(err) });
    }
  }

  return { conversationChannelId, conversationThreadId, createdThread };
}

export async function handleMention(
  packet: MessageCreatePacketType,
  ctx: HandlerContext,
): Promise<void> {
  const { data } = packet;
  const sourceChannelId = data.channel.id;

  return withSpan(
    "chat.mention",
    {
      "chat.channel_id": sourceChannelId,
      "chat.user_id": data.author.id,
      "chat.already_in_thread": Boolean(data.thread),
    },
    async () => {
      const alreadyInThread = Boolean(data.thread);
      const lookupThreadId = alreadyInThread ? sourceChannelId : undefined;
      const logger = createWideLogger({
        op: "chat.mention",
        chat: {
          channel_id: sourceChannelId,
          user_id: data.author.id,
          already_in_thread: alreadyInThread,
        },
      });
      const startTime = Date.now();

      const content = stripBotMention(data.content, ctx.botUserId);

      if (!content) {
        countMetric("chat.mention.empty");
        await ctx.discord.channels.createMessage(sourceChannelId, {
          content: "Hey! What can I help you with?",
        });
        logger.emit({ outcome: "empty", duration_ms: Date.now() - startTime });
        return;
      }

      const existing = await ctx.store.get(sourceChannelId, lookupThreadId);
      const routing: MentionRouting = { sourceChannelId, lookupThreadId, alreadyInThread };

      if (existing) {
        const resumed = await tryResumeExistingWorkflow({
          packet,
          ctx,
          existing,
          content,
          routing,
          logger,
        });
        if (resumed) {
          logger.emit({ outcome: "resumed", duration_ms: Date.now() - startTime });
          return;
        }
      }

      await startFreshWorkflow({ packet, ctx, content, routing, logger, startTime });
    },
  );
}

/**
 * Start a fresh chat workflow for a mention that didn't have a live resume
 * target. Creates a thread (best-effort), fetches lead-in context, kicks off
 * `chatWorkflow`, and emits the final wide event.
 */
async function startFreshWorkflow(args: {
  packet: MessageCreatePacketType;
  ctx: HandlerContext;
  content: string;
  routing: MentionRouting;
  logger: WideLogger;
  startTime: number;
}): Promise<void> {
  const { packet, ctx, content, routing, logger, startTime } = args;
  const { data } = packet;
  const { conversationChannelId, conversationThreadId, createdThread } =
    await ensureConversationThread({ ctx, packet, routing, content, logger });

  const { recentMessages, referencedContext } = await fetchLeadInMessages(
    ctx.discord,
    routing.sourceChannelId,
    data,
  );

  const turnContext = AgentContext.fromPacket(packet, {
    threadOverride: createdThread,
    recentMessages,
    referencedContext,
  }).toJSON();

  const run = await start(chatWorkflow, [
    {
      channelId: conversationChannelId,
      threadId: conversationThreadId,
      content,
      context: turnContext,
      traceparent: captureTraceparent(),
    },
  ]);

  setActiveSpanAttributes({ "chat.id": run.runId });
  countMetric("chat.workflow.started");

  await ctx.store.set({
    workflowRunId: run.runId,
    channelId: routing.sourceChannelId,
    threadId: conversationThreadId,
    startedAt: new Date().toISOString(),
  });

  logger.emit({
    outcome: "started",
    duration_ms: Date.now() - startTime,
    chat: {
      id: run.runId,
      workflow_run_id: run.runId,
      lead_in_count: recentMessages?.length ?? 0,
      referenced_count: referencedContext?.length ?? 0,
    },
  });
}
