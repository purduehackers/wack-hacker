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
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          subagent_tokens: result.usage.subagentTokens,
          tool_calls: result.usage.toolCallCount,
          tool_names: result.usage.toolNames,
          steps: result.usage.stepCount,
          text_length: result.text.length,
          model: result.model,
          discord_message_id: result.discordMessageId,
        });
        return result;
      } catch (err) {
        const error = err as Error;
        logger.error(error);
        logger.emit({
          outcome: "error",
          duration_ms: Date.now() - startTime,
          error_class: error.name,
          error_message: error.message,
        });
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
      "chat.user_id": args.context.userId,
      "chat.turn_count": args.turnCount,
    },
    async () => {
      const logger = createWideLogger({
        op: "workflow.chat.persist_snapshot",
        chat: {
          channel_id: channelId,
          thread_id: threadId,
          user_id: args.context.userId,
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
        const error = err as Error;
        logger.error(error);
        logger.emit({
          outcome: "error",
          duration_ms: Date.now() - startTime,
          error_class: error.name,
          error_message: error.message,
        });
      } finally {
        recordDuration("workflow.chat.persist_snapshot_duration", Date.now() - startTime);
      }
    },
  );
}

async function cleanupConversation(args: {
  channelId: string;
  threadId: string | undefined;
  userId: string;
  traceparent: string | undefined;
}) {
  "use step";
  const { channelId, threadId, userId, traceparent } = args;
  return withSpanFromParent(
    traceparent,
    "workflow.chat.cleanup",
    {
      "chat.channel_id": channelId,
      ...(threadId ? { "chat.thread_id": threadId } : {}),
      "chat.user_id": userId,
    },
    async () => {
      const logger = createWideLogger({
        op: "workflow.chat.cleanup",
        chat: { channel_id: channelId, thread_id: threadId, user_id: userId },
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
        const error = conversationResult.reason as Error;
        logger.error(error);
        logger.emit({
          outcome: "error",
          duration_ms: Date.now() - startTime,
          cleanup,
          error_class: error.name,
          error_message: error.message,
        });
        throw conversationResult.reason;
      }
      logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime, cleanup });
    },
  );
}

/**
 * Per-conversation state mutated across turns. Passed by reference so helpers
 * can push messages / bump counts / swap traceparents without returning a
 * rebuilt state object each call.
 */
interface ConversationState {
  messages: ChatMessage[];
  turnCount: number;
  totalUsage: TurnUsage;
  traceparent: string | undefined;
}

/**
 * Slice of `SerializedAgentContext` that stays fixed once the workflow
 * starts: the conversation's channel/thread and the lead-in messages that
 * preceded the initial mention. Re-applied on every followup turn so the
 * event's per-turn context (author, role, attachments) combines cleanly
 * with the pinned location.
 */
interface StableScope {
  channel: SerializedAgentContext["channel"];
  thread: SerializedAgentContext["thread"];
  recentMessages: SerializedAgentContext["recentMessages"];
  referencedContext: SerializedAgentContext["referencedContext"];
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

async function handleFollowupTurn(args: {
  event: Extract<ChatHookEvent, { type: "message" }>;
  state: ConversationState;
  stable: StableScope;
  channelId: string;
  threadId: string | undefined;
  workflowRunId: string;
}): Promise<void> {
  const { event, state, stable, channelId, threadId, workflowRunId } = args;
  if (event.traceparent) state.traceparent = event.traceparent;
  const turnContext: SerializedAgentContext = { ...event.context, ...stable };
  state.messages.push({ role: "user", content: event.content });
  const turn = await runTurn({
    channelId,
    messages: state.messages,
    serializedContext: turnContext,
    workflowRunId,
    turnIndex: state.turnCount + 1,
    traceparent: state.traceparent,
  });
  state.messages.push({ role: "assistant", content: turn.text });
  capHistory(state.messages);
  state.turnCount += 1;
  state.totalUsage = addTurnUsage(state.totalUsage, turn.usage);
  await persistSnapshot(
    channelId,
    threadId,
    {
      context: turnContext,
      messages: state.messages,
      totalUsage: state.totalUsage,
      turnCount: state.turnCount,
    },
    state.traceparent,
  );
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
  // one Discord channel/thread and the pre-conversation lead-in does not
  // change. Per-turn context splats these verbatim from the initial payload.
  const stable: StableScope = {
    channel: context.channel,
    thread: context.thread,
    recentMessages: context.recentMessages,
    referencedContext: context.referencedContext,
  };

  const workflowStart = Date.now();
  const { messages, totalUsage: initialUsage } = await runFirstTurn({
    payload,
    workflowRunId,
    traceparent,
  });
  const state: ConversationState = {
    messages,
    turnCount: 1,
    totalUsage: initialUsage,
    traceparent,
  };

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
    await handleFollowupTurn({ event, state, stable, channelId, threadId, workflowRunId });
  }

  await cleanupConversation({
    channelId,
    threadId,
    userId: context.userId,
    traceparent: state.traceparent,
  });
  workflowLogger.emit({
    outcome: "ok",
    duration_ms: Date.now() - workflowStart,
    ended_by: endedByUser ? "user" : "hook_close",
    turn_count: state.turnCount,
    total_tokens: state.totalUsage.totalTokens,
    tool_calls: state.totalUsage.toolCallCount,
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
