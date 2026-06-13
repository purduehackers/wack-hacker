import { generateText } from "ai";
import { createHook, FatalError, getWorkflowMetadata, sleep } from "workflow";

import type {
  ChatMessage,
  SerializedAgentContext,
  StreamTurnResult,
  TurnUsage,
} from "@/lib/ai/types";

import { ContextSnapshotStore } from "@/bot/context-snapshot";
import { ConversationStore } from "@/bot/store";
import { streamTurn } from "@/lib/ai/streaming";
import { addTurnUsage, emptyTurnUsage } from "@/lib/ai/turn-usage";
import { createDiscordAPI } from "@/lib/discord/client";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { runInstrumented } from "@/lib/otel/instrumented";
import { withSpanFromParent } from "@/lib/otel/tracing";
import { releaseSession } from "@/lib/sandbox/session";

import type { ChatHookEvent, ChatPayload } from "./types";

export type { ChatHookEvent, ChatPayload } from "./types";

/** Cap on accumulated user+assistant turns — 25 exchanges. */
const MAX_HISTORY_MESSAGES = 50;

/**
 * Stored assistant turns are clipped to this many chars. The full text was
 * already delivered to Discord; history only needs enough for continuity.
 */
const MAX_STORED_ASSISTANT_CHARS = 4000;

/** Cheap model that compacts dropped history into one summary message. */
const HISTORY_SUMMARY_MODEL = "openai/gpt-5.4-mini";

/**
 * How long the hook loop waits for a follow-up before ending the
 * conversation. Must stay strictly BELOW the 1h ConversationStore TTL
 * (src/bot/store.ts): the key's TTL is refreshed when a message arrives but
 * the idle timer is armed only after the turn finishes, so an idle window of
 * exactly 1h would always find the key already expired and skip cleanup. The
 * 5m margin covers turn duration; `cleanupConversation` compare-and-deletes
 * on `workflowRunId` as a second guard against cleaning up a successor.
 */
const IDLE_TIMEOUT = "55m";

/** Race sentinel for the idle timeout; never confusable with an IteratorResult. */
const IDLE = "idle-timeout";

/**
 * After cleanup, how long the workflow listens for stragglers: a resumeHook
 * that succeeded just as the loop stopped consuming events would otherwise
 * sit in the hook buffer forever — the sender saw success, so nobody starts
 * a fresh workflow and the message would be silently dropped.
 */
const DRAIN_GRACE = "10s";

function truncateForHistory(text: string): string {
  if (text.length <= MAX_STORED_ASSISTANT_CHARS) return text;
  return `${text.slice(0, MAX_STORED_ASSISTANT_CHARS)}\n[truncated]`;
}

async function summarizeHistory(dropped: ChatMessage[]): Promise<string> {
  "use step";
  const transcript = dropped.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const { text } = await generateText({
    model: HISTORY_SUMMARY_MODEL,
    prompt:
      "Summarize this conversation excerpt in under 200 words. Preserve concrete facts, decisions, names, links, and any commitments the assistant made. Write it as context the assistant will rely on to continue the conversation.\n\n" +
      transcript,
  });
  return text;
}
summarizeHistory.maxRetries = 1;

/**
 * Keep history under the cap by replacing the dropped prefix with one
 * cheap-model summary message. Falls back to plain dropping when the summary
 * step fails — losing old context beats failing the conversation.
 */
async function capHistory(messages: ChatMessage[]): Promise<void> {
  if (messages.length <= MAX_HISTORY_MESSAGES) return;
  // +1 reserves room for the summary message itself; then advance to the next
  // user message so the retained history starts with a user turn. (The
  // summary is also user-role, so the model may see two consecutive user
  // messages — the AI SDK provider conversion merges those into one.) Never
  // drop the latest exchange, even on a degenerate non-alternating tail —
  // otherwise a failed summary could wipe the entire history.
  const maxDrop = messages.length - 2;
  let dropCount = Math.min(messages.length - MAX_HISTORY_MESSAGES + 1, maxDrop);
  while (dropCount < maxDrop && messages[dropCount].role !== "user") dropCount += 1;
  const dropped = messages.slice(0, dropCount);
  try {
    const summary = await summarizeHistory(dropped);
    messages.splice(0, dropCount, {
      role: "user",
      content: `[Summary of ${dropped.length} earlier messages, compacted to save space]\n${summary}`,
    });
  } catch {
    countMetric("workflow.chat.history_summary_failed");
    messages.splice(0, dropCount);
  }
}

interface RunTurnArgs {
  channelId: string;
  threadId: string | undefined;
  messages: ChatMessage[];
  serializedContext: SerializedAgentContext;
  workflowRunId: string;
  turnIndex: number;
  /** Conversation-wide usage before this turn; the persisted snapshot adds this turn on top. */
  priorUsage: TurnUsage;
  traceparent: string | undefined;
  /**
   * Pre-created "> Thinking..." message id from the mention handler. Set only
   * on the first turn of a fresh workflow so the renderer adopts it instead
   * of posting a new placeholder.
   */
  placeholderMessageId?: string;
}

/**
 * Sentinel for a turn that failed after side effects may have run. The user
 * was already shown a failure message; the workflow stays alive and keeps
 * listening for follow-ups instead of replaying an expensive turn.
 */
interface TurnFailure {
  error: true;
}

/**
 * Best-effort write of the per-turn debug snapshot consumed by the
 * /inspect-context command. Persists only the cheap dynamic slice — the
 * inspector derives the system prompt + materialized tool schemas on demand
 * at read time (src/lib/ai/snapshot.ts). A Redis blip must not fail the turn.
 */
async function persistSnapshot(args: {
  channelId: string;
  threadId: string | undefined;
  context: SerializedAgentContext;
  messages: ChatMessage[];
  totalUsage: TurnUsage;
  turnCount: number;
}): Promise<void> {
  const startTime = Date.now();
  try {
    await new ContextSnapshotStore().set(args.channelId, args.threadId, {
      context: args.context,
      messages: args.messages,
      totalUsage: args.totalUsage,
      turnCount: args.turnCount,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    countMetric("workflow.chat.snapshot_error");
  } finally {
    recordDuration("workflow.chat.persist_snapshot_duration", Date.now() - startTime);
  }
}

async function runTurn(args: RunTurnArgs): Promise<StreamTurnResult | TurnFailure> {
  "use step";
  const {
    channelId,
    threadId,
    messages,
    serializedContext,
    workflowRunId,
    turnIndex,
    priorUsage,
    traceparent,
    placeholderMessageId,
  } = args;
  const startTime = Date.now();
  try {
    return await runInstrumented(
      {
        op: "workflow.chat.run_turn",
        traceparent,
        spanAttrs: {
          "chat.id": workflowRunId,
          "chat.channel_id": channelId,
          "chat.turn_index": turnIndex,
          "chat.user_id": serializedContext.userId,
        },
        loggerContext: {
          chat: {
            id: workflowRunId,
            channel_id: channelId,
            thread_id: serializedContext.thread?.id,
            user_id: serializedContext.userId,
            turn_index: turnIndex,
          },
        },
      },
      async (logger) => {
        const discord = createDiscordAPI();
        const result = await streamTurn(discord, channelId, messages, serializedContext, {
          workflowRunId,
          turnIndex,
          placeholderMessageId,
        });
        await persistSnapshot({
          channelId,
          threadId,
          context: serializedContext,
          messages: [...messages, { role: "assistant", content: truncateForHistory(result.text) }],
          totalUsage: addTurnUsage(priorUsage, result.usage),
          turnCount: turnIndex,
        });
        logger.set({
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
      },
    );
  } catch (err) {
    // streamTurn classifies failures that happen once the stream is live as
    // FatalError, after showing the user a failure message. Swallow those so
    // the workflow keeps listening — replaying would re-run subagent
    // delegations and external writes. Anything else failed before the
    // stream started and is safe for WDK to retry.
    if (err instanceof FatalError) {
      countMetric("workflow.chat.turn_failed");
      return { error: true };
    }
    throw err;
  } finally {
    recordDuration("workflow.chat.run_turn_duration", Date.now() - startTime, {
      turn: turnIndex === 1 ? "first" : "followup",
    });
  }
}

/**
 * Last-resort user notification for turns that died before `streamTurn`
 * could render its own failure message (e.g. the step exhausted its retries
 * on a pre-stream error). Best-effort: never throws.
 */
async function notifyTurnFailure(args: {
  channelId: string;
  placeholderMessageId?: string;
}): Promise<void> {
  "use step";
  const content = "Something went wrong while answering — try again.";
  try {
    const discord = createDiscordAPI();
    if (args.placeholderMessageId) {
      await discord.channels.editMessage(args.channelId, args.placeholderMessageId, { content });
    } else {
      await discord.channels.createMessage(args.channelId, { content });
    }
  } catch {
    countMetric("workflow.chat.notify_failure_error");
  }
}

async function cleanupConversation(args: {
  channelId: string;
  threadId: string | undefined;
  userId: string;
  workflowRunId: string;
  traceparent: string | undefined;
}) {
  "use step";
  const { channelId, threadId, userId, workflowRunId, traceparent } = args;
  return withSpanFromParent(
    traceparent,
    "workflow.chat.cleanup",
    {
      "chat.id": workflowRunId,
      "chat.channel_id": channelId,
      ...(threadId ? { "chat.thread_id": threadId } : {}),
      "chat.user_id": userId,
    },
    async () => {
      const logger = createWideLogger({
        op: "workflow.chat.cleanup",
        chat: { id: workflowRunId, channel_id: channelId, thread_id: threadId, user_id: userId },
      });
      const startTime = Date.now();
      const threadKey = threadId ?? channelId;
      const store = new ConversationStore();

      // Compare-and-delete: a successor workflow may own this thread by now
      // (this run idled past the conversation TTL and a new mention started a
      // fresh run). Deleting blindly would tear down the successor's
      // conversation key and stop its live sandbox.
      const currentOwner = await store.get(channelId, threadId);
      if (currentOwner?.workflowRunId !== workflowRunId) {
        countMetric("workflow.chat.cleanup_skipped_stale");
        logger.emit({
          outcome: "skipped_stale",
          duration_ms: Date.now() - startTime,
          stored_run_id: currentOwner?.workflowRunId ?? null,
        });
        return;
      }

      // Snapshot + sandbox release are best-effort; only the ConversationStore
      // delete is load-bearing for starting a fresh workflow later.
      const [conversationResult, snapshotResult, sandboxResult] = await Promise.allSettled([
        store.delete(channelId, threadId),
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
 * starts: the conversation's channel/thread, the lead-in messages that
 * preceded the initial mention, and the first turn's date/instant/timezone.
 * Re-applied on every followup turn so the event's per-turn context (author,
 * role, attachments) combines cleanly with the pinned fields.
 *
 * Date and time are pinned deliberately: they're interpolated into the
 * system prompt, and a prompt that changes between turns invalidates the
 * Anthropic prompt cache for the whole conversation prefix. Followup turns
 * get the true current time stamped onto the user message instead (see
 * `stampCurrentTime`).
 */
interface StableScope {
  channel: SerializedAgentContext["channel"];
  thread: SerializedAgentContext["thread"];
  recentMessages: SerializedAgentContext["recentMessages"];
  recentMessagesFromThread: SerializedAgentContext["recentMessagesFromThread"];
  referencedContext: SerializedAgentContext["referencedContext"];
  date: SerializedAgentContext["date"];
  nowISO: SerializedAgentContext["nowISO"];
  timezone: SerializedAgentContext["timezone"];
}

/**
 * Followup turns past this count drop the scraped lead-in blocks from the
 * system prompt — by then the model has real conversation history and the
 * lead-in is just pinned token weight. Dropping it changes the prompt once
 * (one cache miss at the boundary turn), after which it is stable again.
 */
const LEADIN_TURN_LIMIT = 3;

/**
 * Append the turn's wall-clock time to a followup user message. The system
 * prompt's `{{NOW_ISO}}`/`{{DATE}}` are pinned to the first turn so the
 * prompt stays byte-stable across turns; this stamp is how later turns learn
 * the real current time. It is persisted into conversation history so the
 * replayed prefix stays byte-stable too.
 */
function stampCurrentTime(content: string, nowISO: string | undefined): string {
  return nowISO ? `${content}\n\n[current time: ${nowISO}]` : content;
}

/**
 * Run one conversation turn: push the user message, execute the turn step,
 * and fold the assistant reply into history. On failure (sentinel or a step
 * error after retries) the pushed user message is popped so the failed turn
 * leaves no trace and a follow-up starts clean.
 */
async function runConversationTurn(args: {
  state: ConversationState;
  channelId: string;
  threadId: string | undefined;
  workflowRunId: string;
  content: string;
  serializedContext: SerializedAgentContext;
  placeholderMessageId?: string;
}): Promise<void> {
  const { state, channelId, threadId, workflowRunId, content, serializedContext } = args;
  const { placeholderMessageId } = args;
  const turnLabel = state.turnCount === 0 ? "first" : "followup";
  state.messages.push({ role: "user", content });
  let turn: StreamTurnResult | TurnFailure;
  try {
    turn = await runTurn({
      channelId,
      threadId,
      messages: state.messages,
      serializedContext,
      workflowRunId,
      turnIndex: state.turnCount + 1,
      priorUsage: state.totalUsage,
      traceparent: state.traceparent,
      placeholderMessageId,
    });
  } catch {
    await notifyTurnFailure({ channelId, placeholderMessageId });
    turn = { error: true };
  }
  if ("error" in turn) {
    countMetric("workflow.chat.turn_error", { turn: turnLabel });
    state.messages.pop();
    return;
  }
  state.messages.push({ role: "assistant", content: truncateForHistory(turn.text) });
  await capHistory(state.messages);
  state.turnCount += 1;
  state.totalUsage = addTurnUsage(state.totalUsage, turn.usage);
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
  await runConversationTurn({
    state,
    channelId,
    threadId,
    workflowRunId,
    content: stampCurrentTime(event.content, event.context.nowISO),
    serializedContext: {
      ...event.context,
      ...stable,
      ...(state.turnCount >= LEADIN_TURN_LIMIT
        ? { recentMessages: undefined, referencedContext: undefined }
        : {}),
    },
  });
}

/**
 * Single-flight view over the hook iterator that survives lost races. A
 * `next()` abandoned when a timer wins the race stays armed and is re-awaited
 * by the next caller — calling `hookEvents.next()` again would enqueue a
 * second waiter behind the abandoned one, and the first event to arrive would
 * resolve the abandoned promise and vanish. Callers `consume()` after a race
 * the event won so the following call arms a fresh `next()`.
 */
interface HookEventSource {
  next(): Promise<IteratorResult<ChatHookEvent>>;
  consume(): void;
}

function createHookEventSource(hookEvents: AsyncIterator<ChatHookEvent>): HookEventSource {
  let pending: Promise<IteratorResult<ChatHookEvent>> | null = null;
  return {
    next() {
      pending ??= hookEvents.next();
      return pending;
    },
    consume() {
      pending = null;
    },
  };
}

/**
 * Answer hook events that landed in the buffer after the main loop stopped
 * consuming them: a resumeHook that was in flight while the loop exited
 * succeeded from its sender's perspective (handlers touch-and-return), so
 * dropping the event would silently eat a user message. Runs after cleanup —
 * the conversation key is already gone, so no new resume targets this run.
 */
async function drainStragglers(args: {
  events: HookEventSource;
  state: ConversationState;
  stable: StableScope;
  channelId: string;
  threadId: string | undefined;
  workflowRunId: string;
  workflowLogger: ReturnType<typeof createWideLogger>;
}): Promise<void> {
  const { events, state, stable, channelId, threadId, workflowRunId, workflowLogger } = args;
  try {
    while (true) {
      const straggler = await Promise.race([events.next(), sleep(DRAIN_GRACE).then(() => IDLE)]);
      if (typeof straggler === "string") break;
      events.consume();
      if (straggler.done) break;
      const event = straggler.value;
      countMetric("workflow.chat.drained_event", { type: event.type });
      if (event.type !== "message" || !event.content) continue;
      await handleFollowupTurn({ event, state, stable, channelId, threadId, workflowRunId });
    }
  } catch (err) {
    countMetric("workflow.chat.drain_error");
    workflowLogger.warn("post-cleanup drain failed", { reason: String(err) });
  }
}

/**
 * Consume hook events until the conversation ends: a `done` event, the idle
 * timeout, or the hook closing. Returns how the loop ended.
 */
async function runHookLoop(args: {
  events: HookEventSource;
  state: ConversationState;
  stable: StableScope;
  channelId: string;
  threadId: string | undefined;
  workflowRunId: string;
}): Promise<"user" | "idle_timeout" | "hook_close"> {
  const { events, state, stable, channelId, threadId, workflowRunId } = args;
  while (true) {
    // Documented WDK timeout pattern: race the next hook event against a
    // durable sleep. A losing sleep keeps ticking but is discarded when the
    // workflow ends.
    const winner = await Promise.race([events.next(), sleep(IDLE_TIMEOUT).then(() => IDLE)]);
    if (typeof winner === "string") {
      countMetric("workflow.chat.idle_timeout");
      return "idle_timeout";
    }
    events.consume();
    if (winner.done) return "hook_close";
    const event = winner.value;
    countMetric("workflow.chat.hook_event", { type: event.type });
    if (event.type === "done") {
      countMetric("workflow.chat.ended");
      return "user";
    }
    if (!event.content) continue;
    countMetric("workflow.chat.followup");
    await handleFollowupTurn({ event, state, stable, channelId, threadId, workflowRunId });
  }
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
  // one Discord channel/thread, the pre-conversation lead-in does not change,
  // and date/now/timezone are frozen at first-turn values to keep the system
  // prompt byte-stable for prompt caching. Per-turn context splats these
  // verbatim from the initial payload.
  const stable: StableScope = {
    channel: context.channel,
    thread: context.thread,
    recentMessages: context.recentMessages,
    // Pinned with the lead-in it describes — followup packets carry no lead-in,
    // so their context would otherwise flip the rendered block's tag.
    recentMessagesFromThread: context.recentMessagesFromThread,
    referencedContext: context.referencedContext,
    date: context.date,
    nowISO: context.nowISO,
    timezone: context.timezone,
  };

  const state: ConversationState = {
    messages: [],
    turnCount: 0,
    totalUsage: emptyTurnUsage(),
    traceparent,
  };

  const workflowStart = Date.now();
  using hook = createHook<ChatHookEvent>({ token: workflowRunId });
  const events = createHookEventSource(hook[Symbol.asyncIterator]());

  let endedBy: "user" | "idle_timeout" | "hook_close" | "error" = "error";
  try {
    await runConversationTurn({
      state,
      channelId,
      threadId,
      workflowRunId,
      content: payload.content,
      serializedContext: payload.context,
      placeholderMessageId: payload.placeholderMessageId,
    });
    endedBy = await runHookLoop({ events, state, stable, channelId, threadId, workflowRunId });
  } finally {
    try {
      // The error path must release the conversation too — otherwise the
      // thread stays claimed until the Redis TTL expires with no way to
      // start fresh.
      await cleanupConversation({
        channelId,
        threadId,
        userId: context.userId,
        workflowRunId,
        traceparent: state.traceparent,
      });
      await drainStragglers({
        events,
        state,
        stable,
        channelId,
        threadId,
        workflowRunId,
        workflowLogger,
      });
    } finally {
      // Always emit the conversation's single terminal wide event, even when
      // cleanup itself failed — losing ended_by/turn_count telemetry would
      // make the conversation vanish from analytics.
      workflowLogger.emit({
        outcome: endedBy === "error" ? "error" : "ok",
        duration_ms: Date.now() - workflowStart,
        ended_by: endedBy,
        turn_count: state.turnCount,
        total_tokens: state.totalUsage.totalTokens,
        tool_calls: state.totalUsage.toolCallCount,
      });
    }
  }
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
