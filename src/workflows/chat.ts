import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { createHook, getWorkflowMetadata } from "workflow";

import type { ChatMessage, SerializedAgentContext, TurnUsage } from "@/lib/ai/types";

import { ContextSnapshotStore } from "@/bot/context-snapshot";
import { ConversationStore } from "@/bot/store";
import { buildContextSnapshot } from "@/lib/ai/snapshot";
import { streamTurn } from "@/lib/ai/streaming";
import { addTurnUsage, emptyTurnUsage } from "@/lib/ai/turn-usage";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpanFromParent } from "@/lib/otel/tracing";
import { releaseSession } from "@/lib/sandbox/session";

import type { ChatHookEvent, ChatPayload } from "./types";

export type { ChatHookEvent, ChatPayload } from "./types";

/** Cap on accumulated user+assistant turns — 25 exchanges. Drops oldest pairs. */
const MAX_HISTORY_MESSAGES = 50;

// TODO: run the dropped messages through a small fast model (e.g. Haiku) and
// replace them with a compact summary assistant message, instead of throwing
// the context away entirely. Preserves continuity on long conversations at
// the cost of one extra round-trip per cap event.
function capHistory(messages: ChatMessage[]): void {
  if (messages.length <= MAX_HISTORY_MESSAGES) return;
  // Drop pairs (even count) so history always starts with a user message.
  const excess = messages.length - MAX_HISTORY_MESSAGES;
  messages.splice(0, excess + (excess % 2));
}

interface RunTurnArgs {
  channelId: string;
  messages: ChatMessage[];
  serializedContext: SerializedAgentContext;
  workflowRunId: string;
  turnIndex: number;
  traceparent: string | undefined;
}

async function runTurn(args: RunTurnArgs) {
  "use step";
  const { channelId, messages, serializedContext, workflowRunId, turnIndex, traceparent } = args;
  return withSpanFromParent(
    traceparent,
    "workflow.chat.run_turn",
    {
      "chat.id": workflowRunId,
      "chat.channel_id": channelId,
      "chat.turn_index": turnIndex,
      "chat.user_id": serializedContext.userId,
    },
    async () => {
      const logger = createWideLogger({
        op: "workflow.chat.run_turn",
        chat: {
          id: workflowRunId,
          channel_id: channelId,
          thread_id: serializedContext.thread?.id,
          user_id: serializedContext.userId,
          turn_index: turnIndex,
        },
      });
      const startTime = Date.now();
      const discord = new API(new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN!));
      try {
        const result = await streamTurn(discord, channelId, messages, serializedContext, {
          workflowRunId,
          turnIndex,
        });
        logger.emit({
          outcome: "ok",
          duration_ms: Date.now() - startTime,
          turn: turnIndex === 1 ? "first" : "followup",
          tokens: result.usage.totalTokens,
          tool_calls: result.usage.toolCallCount,
          steps: result.usage.stepCount,
          text_length: result.text.length,
        });
        return result;
      } catch (err) {
        logger.error(err as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
        throw err;
      } finally {
        recordDuration("workflow.chat.run_turn_duration", Date.now() - startTime, {
          turn: turnIndex === 1 ? "first" : "followup",
        });
      }
    },
  );
}

async function persistSnapshot(
  channelId: string,
  threadId: string | undefined,
  args: {
    context: SerializedAgentContext;
    messages: ChatMessage[];
    totalUsage: TurnUsage;
    turnCount: number;
  },
  traceparent: string | undefined,
) {
  "use step";
  return withSpanFromParent(
    traceparent,
    "workflow.chat.persist_snapshot",
    {
      "chat.channel_id": channelId,
      ...(threadId ? { "chat.thread_id": threadId } : {}),
      "chat.turn_count": args.turnCount,
    },
    async () => {
      const logger = createWideLogger({
        op: "workflow.chat.persist_snapshot",
        chat: {
          channel_id: channelId,
          thread_id: threadId,
          turn_count: args.turnCount,
          total_tokens: args.totalUsage.totalTokens,
        },
      });
      const startTime = Date.now();
      // Build the snapshot inside the step. buildContextSnapshot materializes the
      // full orchestrator tool set (AI SDK `tool()` wrappers, Zod → JSON Schema
      // conversion), which must not run in the workflow sandbox. Best-effort: a
      // Redis blip should not abort the chat workflow.
      try {
        const snapshot = buildContextSnapshot(args);
        await new ContextSnapshotStore().set(channelId, threadId, snapshot);
        logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
      } catch (err) {
        countMetric("workflow.chat.snapshot_error");
        logger.error(err as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
      } finally {
        recordDuration("workflow.chat.persist_snapshot_duration", Date.now() - startTime);
      }
    },
  );
}

async function cleanupConversation(
  channelId: string,
  threadId: string | undefined,
  traceparent: string | undefined,
) {
  "use step";
  return withSpanFromParent(
    traceparent,
    "workflow.chat.cleanup",
    {
      "chat.channel_id": channelId,
      ...(threadId ? { "chat.thread_id": threadId } : {}),
    },
    async () => {
      const logger = createWideLogger({
        op: "workflow.chat.cleanup",
        chat: { channel_id: channelId, thread_id: threadId },
      });
      const startTime = Date.now();
      const threadKey = threadId ?? channelId;
      // Snapshot + sandbox release are best-effort; only the ConversationStore
      // delete is load-bearing for starting a fresh workflow later.
      const [conversationResult, snapshotResult, sandboxResult] = await Promise.allSettled([
        new ConversationStore().delete(channelId),
        new ContextSnapshotStore().delete(channelId, threadId),
        releaseSession(threadKey),
      ]);
      const cleanup = {
        snapshot: snapshotResult.status,
        sandbox: sandboxResult.status,
        conversation: conversationResult.status,
      };
      if (snapshotResult.status === "rejected") {
        countMetric("workflow.chat.snapshot_cleanup_error");
        logger.warn("snapshot delete failed", { reason: String(snapshotResult.reason) });
      }
      if (sandboxResult.status === "rejected") {
        countMetric("workflow.chat.sandbox_cleanup_error");
        logger.warn("sandbox release failed", { reason: String(sandboxResult.reason) });
      }
      recordDuration("workflow.chat.cleanup_duration", Date.now() - startTime);
      if (conversationResult.status === "rejected") {
        logger.error(conversationResult.reason as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime, cleanup });
        throw conversationResult.reason;
      }
      logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime, cleanup });
    },
  );
}

async function runFirstTurn(args: {
  payload: ChatPayload;
  workflowRunId: string;
  traceparent: string | undefined;
}): Promise<{ messages: ChatMessage[]; totalUsage: TurnUsage }> {
  const { payload, workflowRunId, traceparent } = args;
  const { channelId, threadId, content, context } = payload;
  const messages: ChatMessage[] = [{ role: "user", content }];
  const first = await runTurn({
    channelId,
    messages,
    serializedContext: context,
    workflowRunId,
    turnIndex: 1,
    traceparent,
  });
  messages.push({ role: "assistant", content: first.text });
  capHistory(messages);
  const totalUsage = addTurnUsage(emptyTurnUsage(), first.usage);
  await persistSnapshot(
    channelId,
    threadId,
    { context, messages, totalUsage, turnCount: 1 },
    traceparent,
  );
  return { messages, totalUsage };
}

/**
 * Run the chat workflow body. Extracted from `chatWorkflow` so the outer
 * function can stay a thin span wrapper. Assumes it's invoked inside a
 * `workflow.chat` span whose trace id was joined to the initiating mention.
 */
async function runChatWorkflow(payload: ChatPayload, workflowRunId: string): Promise<void> {
  const { channelId, threadId, context, traceparent } = payload;

  const workflowLogger = createWideLogger({
    op: "workflow.chat",
    chat: {
      id: workflowRunId,
      channel_id: channelId,
      thread_id: threadId,
      user_id: context.userId,
    },
  });
  workflowLogger.info("chat workflow started");
  countMetric("workflow.chat.started");

  // Stable for the lifetime of this workflow — the conversation is pinned to
  // one Discord channel/thread and the pre-conversation message lead-in does
  // not change. Per-turn context takes these verbatim from the initial payload.
  const stableChannel = context.channel;
  const stableThread = context.thread;
  const stableRecentMessages = context.recentMessages;
  const stableReferencedContext = context.referencedContext;

  // Tracks the trace each turn's step spans join. Starts at the initial
  // mention's traceparent and updates on every hook event so followup turns
  // join their own mention's trace. Steps run in separate executions that do
  // not inherit OTEL context, so we pass this through explicitly.
  let currentTraceparent = traceparent;

  const workflowStart = Date.now();
  const { messages, totalUsage: initialUsage } = await runFirstTurn({
    payload,
    workflowRunId,
    traceparent: currentTraceparent,
  });
  let turnCount = 1;
  let totalUsage = initialUsage;

  using hook = createHook<ChatHookEvent>({ token: workflowRunId });

  let endedByUser = false;

  for await (const event of hook) {
    countMetric("workflow.chat.hook_event", { type: event.type });
    if (event.type === "done") {
      countMetric("workflow.chat.ended");
      endedByUser = true;
      break;
    }
    if (!event.content) continue;

    countMetric("workflow.chat.followup");

    if (event.traceparent) currentTraceparent = event.traceparent;

    // Merge the fresh per-turn identity from the event with the stable
    // location + lead-in pinned at workflow start.
    const turnContext: SerializedAgentContext = {
      ...event.context,
      channel: stableChannel,
      thread: stableThread,
      recentMessages: stableRecentMessages,
      referencedContext: stableReferencedContext,
    };

    messages.push({ role: "user", content: event.content });
    const turn = await runTurn({
      channelId,
      messages,
      serializedContext: turnContext,
      workflowRunId,
      turnIndex: turnCount + 1,
      traceparent: currentTraceparent,
    });
    messages.push({ role: "assistant", content: turn.text });
    capHistory(messages);
    turnCount += 1;
    totalUsage = addTurnUsage(totalUsage, turn.usage);
    await persistSnapshot(
      channelId,
      threadId,
      { context: turnContext, messages, totalUsage, turnCount },
      currentTraceparent,
    );
  }

  await cleanupConversation(channelId, threadId, currentTraceparent);
  workflowLogger.emit({
    outcome: "ok",
    duration_ms: Date.now() - workflowStart,
    ended_by: endedByUser ? "user" : "hook_close",
    turn_count: turnCount,
    total_tokens: totalUsage.totalTokens,
    tool_calls: totalUsage.toolCallCount,
  });
}

export async function chatWorkflow(payload: ChatPayload) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();

  return withSpanFromParent(
    payload.traceparent,
    "workflow.chat",
    {
      "chat.id": workflowRunId,
      "chat.channel_id": payload.channelId,
      ...(payload.threadId ? { "chat.thread_id": payload.threadId } : {}),
      "chat.user_id": payload.context.userId,
    },
    () => runChatWorkflow(payload, workflowRunId),
  );
}
