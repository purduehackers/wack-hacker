import type { API } from "@discordjs/core/http-only";

import { trace } from "@opentelemetry/api";
import { isTextUIPart, type UIMessage } from "ai";

import type { TurnMessageRecord } from "@/bot/types";

import { TurnMessageStore } from "@/bot/turn-message-store";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDistribution, recordDuration } from "@/lib/metrics";
import { buildChatAttributes } from "@/lib/otel/chat-attributes";
import { setActiveSpanAttributes, withSpan } from "@/lib/otel/tracing";

import type {
  Attachment,
  ChatMessage,
  SerializedAgentContext,
  StreamTurnOptions,
  StreamTurnResult,
  TurnUsage,
  UsageLike,
} from "./types.ts";

import { ORCHESTRATOR_MODEL } from "./constants.ts";
import { AgentContext } from "./context.ts";
import { MessageRenderer } from "./message-renderer.ts";
import { createOrchestrator } from "./orchestrator.ts";
import { estimateCostUsd } from "./pricing.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

/**
 * Split an AI-gateway model slug (e.g. `"anthropic/claude-sonnet-4.6"`) into
 * provider + model parts for separate span attributes. Falls back to the
 * whole slug as the model name when no provider prefix is present.
 */
export function parseModelSlug(slug: string): { provider: string | undefined; model: string } {
  const slash = slug.indexOf("/");
  if (slash <= 0) return { provider: undefined, model: slug };
  return { provider: slug.slice(0, slash), model: slug.slice(slash + 1) };
}

const USER_BUCKET_COUNT = 16;

/**
 * Deterministically fold a Discord user id into one of 16 stable buckets
 * (`"u00"`–`"u15"`) for metric attributes. Raw user ids are forbidden there
 * (unbounded cardinality); a bucket is enough to spot one user dominating
 * token spend without identifying them. FNV-1a 32-bit over UTF-16 code units.
 */
export function bucketUserId(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `u${(hash % USER_BUCKET_COUNT).toString().padStart(2, "0")}`;
}

/**
 * Orchestrator cost at `ORCHESTRATOR_MODEL` rates plus each subagent
 * delegation at its own model's rates. Models missing from the price table
 * contribute 0 — they were already counted via `ai.cost.unknown_model` at
 * `recordSubagentMetrics` time, and pricing.test.ts pins the orchestrator
 * model into the table so its lookup cannot miss.
 */
function computeTurnCostUsd(tracker: TurnUsageTracker): number {
  const records = [
    { model: ORCHESTRATOR_MODEL, ...tracker.orchestratorUsage },
    ...tracker.subagentUsage,
  ];
  return records.reduce((sum, record) => sum + (estimateCostUsd(record) ?? 0), 0);
}

export type { OrchestratorAgent, OrchestratorFactory, StreamTurnOptions } from "./types.ts";
export { MessageRenderer } from "./message-renderer.ts";

type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: URL }
  | { type: "file"; data: URL; filename: string; mediaType: string };

/**
 * Build a user-role message, inlining attachments as multimodal content parts
 * when present. The returned message is suitable for use in the last slot of
 * an AI SDK `messages` array.
 */
export function buildUserMessage(content: string, attachments?: Attachment[]) {
  if (!attachments?.length) {
    return { role: "user" as const, content };
  }

  const parts: UserContentPart[] = [{ type: "text", text: content }];

  for (const a of attachments) {
    if (a.contentType?.startsWith("image/")) {
      parts.push({ type: "image", image: new URL(a.url) });
    } else {
      parts.push({
        type: "file",
        data: new URL(a.url),
        filename: a.filename,
        mediaType: a.contentType ?? "application/octet-stream",
      });
    }
  }

  return { role: "user" as const, content: parts };
}

/** Extract the latest text from a subagent's UIMessage for inline preview. */
function previewSubagentText(message: UIMessage): string {
  const last = message.parts.findLast(isTextUIPart);
  return last?.text ?? "";
}

/**
 * Run a single agent turn. `messages` is the full conversation history so far,
 * where the LAST entry is the current user input. Prior entries are passed to
 * the model as assistant/user turns so it has real conversation memory rather
 * than relying on scraped channel history.
 *
 * Attachments from the serialized context are applied to the current user
 * message only (the last entry in `messages`).
 */
export async function streamTurn(
  discord: API,
  channelId: string,
  messages: ChatMessage[],
  serializedContext: SerializedAgentContext,
  options: StreamTurnOptions = {},
): Promise<StreamTurnResult> {
  const { taskId, workflowRunId, turnIndex } = options;
  const chatAttrs = workflowRunId
    ? buildChatAttributes({ workflowRunId, context: serializedContext, turnIndex })
    : undefined;
  const { provider, model } = parseModelSlug(ORCHESTRATOR_MODEL);
  return withSpan(
    "chat.turn",
    {
      ...chatAttrs,
      "chat.channel_id": serializedContext.channel.id,
      "chat.user_id": serializedContext.userId,
      "chat.message_count": messages.length,
      "ai.model": model,
      ...(provider ? { "ai.provider": provider } : {}),
      ...(taskId ? { "task.id": taskId } : {}),
    },
    () => runStreamTurn({ discord, channelId, messages, serializedContext, options, chatAttrs }),
  );
}

async function runStreamTurn(args: {
  discord: API;
  channelId: string;
  messages: ChatMessage[];
  serializedContext: SerializedAgentContext;
  options: StreamTurnOptions;
  chatAttrs: ReturnType<typeof buildChatAttributes> | undefined;
}): Promise<StreamTurnResult> {
  const { discord, channelId, messages, serializedContext, options, chatAttrs } = args;
  const {
    taskId,
    createAgent = createOrchestrator,
    workflowRunId,
    turnIndex,
    placeholderMessageId,
    turnMessageStore,
  } = options;
  const agentCtx = AgentContext.fromJSON(serializedContext);
  const tracker = new TurnUsageTracker();
  // The `OrchestratorFactory` return type is a structural subset of the real
  // ToolLoopAgent, so we cast back to the concrete agent type here to keep the
  // stream-event discriminated union typed.
  const agent = createAgent(agentCtx, tracker, chatAttrs) as ReturnType<typeof createOrchestrator>;
  const renderer = new MessageRenderer(discord, channelId, { taskId });

  const logger = createWideLogger({
    op: "ai.turn",
    chat: {
      id: workflowRunId,
      channel_id: channelId,
      thread_id: serializedContext.thread?.id,
      user_id: serializedContext.userId,
      turn_index: turnIndex,
      message_count: messages.length,
    },
    ...(taskId ? { task: { id: taskId } } : {}),
  });

  await renderer.init({ existingMessageId: placeholderMessageId });

  const priorMessages = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const current = messages[messages.length - 1];
  const currentMessage = buildUserMessage(current.content, agentCtx.attachments);

  const startTime = Date.now();
  const result = await agent.stream({ messages: [...priorMessages, currentMessage] });

  await renderStream(result.fullStream, renderer);

  const elapsedMs = Date.now() - startTime;
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  const { metadataError, finalized, costUsd } = await finalizeTurn({
    result,
    tracker,
    renderer,
    elapsedMs,
    logger,
    traceId,
    userBucket: bucketUserId(serializedContext.userId),
  });

  await indexTurnMessages({
    store: turnMessageStore,
    messageIds: [finalized.messageId, ...finalized.overflowIds],
    record: {
      chatId: workflowRunId,
      traceId,
      domains: [...new Set(tracker.subagentUsage.map((s) => s.domain))],
      channelId,
      userId: serializedContext.userId,
    },
  });

  countMetric("ai.turn.completed");
  recordDuration("ai.turn.duration", elapsedMs);

  const usage = tracker.toTurnUsage();
  emitTurnTelemetry({
    usage,
    cachedInputTokens: tracker.totalCachedInputTokens,
    costUsd,
    metadataError,
    elapsedMs,
    textLength: renderer.content.length,
    logger,
    messageId: finalized.messageId,
  });

  return {
    text: renderer.content,
    usage,
    discordMessageId: finalized.messageId,
    model: ORCHESTRATOR_MODEL,
  };
}

/**
 * Mirror the per-turn totals onto the active chat.turn span (so operators can
 * query the trace directly without joining against wide events) and emit the
 * turn's terminal wide event.
 */
function emitTurnTelemetry(args: {
  usage: TurnUsage;
  cachedInputTokens: number;
  costUsd: number | undefined;
  metadataError: unknown;
  elapsedMs: number;
  textLength: number;
  logger: ReturnType<typeof createWideLogger>;
  messageId: string;
}): void {
  const {
    usage,
    cachedInputTokens,
    costUsd,
    metadataError,
    elapsedMs,
    textLength,
    logger,
    messageId,
  } = args;
  setActiveSpanAttributes({
    "ai.input_tokens": usage.inputTokens,
    "ai.output_tokens": usage.outputTokens,
    "ai.cached_input_tokens": cachedInputTokens,
    "ai.subagent_tokens": usage.subagentTokens,
    "ai.total_tokens": usage.totalTokens,
    "ai.tool_calls": usage.toolCallCount,
    "ai.steps": usage.stepCount,
    ...(usage.toolNames.length > 0 ? { "ai.tool_names": usage.toolNames } : {}),
    ...(costUsd !== undefined ? { "ai.cost_usd": costUsd } : {}),
    "chat.discord_message_id": messageId,
  });

  logger.emit({
    outcome: metadataError ? "partial" : "ok",
    duration_ms: elapsedMs,
    text_length: textLength,
    tokens: usage.totalTokens,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cached_input_tokens: cachedInputTokens,
    subagent_tokens: usage.subagentTokens,
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
    tool_calls: usage.toolCallCount,
    tool_names: usage.toolNames,
    steps: usage.stepCount,
    model: ORCHESTRATOR_MODEL,
    discord_message_id: messageId,
  });
}

async function renderStream(
  fullStream: AsyncIterable<unknown>,
  renderer: MessageRenderer,
): Promise<void> {
  let lastTextId: string | undefined;
  for await (const raw of fullStream) {
    const event = raw as {
      type: string;
      id?: string;
      text?: string;
      toolName?: string;
      preliminary?: boolean;
      output?: unknown;
    };
    switch (event.type) {
      case "text-delta": {
        const delta =
          lastTextId !== undefined && event.id !== lastTextId
            ? "\n\n" + (event.text ?? "")
            : (event.text ?? "");
        lastTextId = event.id;
        await renderer.appendText(delta);
        break;
      }
      case "tool-input-start":
        if (event.toolName) await renderer.showToolCall(event.toolName);
        break;
      case "tool-result":
        if (event.preliminary && event.output && typeof event.output === "object") {
          const preview = previewSubagentText(event.output as UIMessage);
          if (preview) await renderer.showSubagentPreview(preview);
        } else {
          renderer.clearActivity();
        }
        break;
      default:
        break;
    }
  }
}

interface FinalizeResult {
  metadataError: unknown;
  finalized: { messageId: string; overflowIds: string[] };
  /** Estimated USD cost for the whole turn; undefined when usage collection failed. */
  costUsd: number | undefined;
}

async function finalizeTurn(args: {
  result: { totalUsage: PromiseLike<unknown>; steps: PromiseLike<unknown> };
  tracker: TurnUsageTracker;
  renderer: MessageRenderer;
  elapsedMs: number;
  logger: ReturnType<typeof createWideLogger>;
  traceId: string | undefined;
  userBucket: string;
}): Promise<FinalizeResult> {
  const { result, tracker, renderer, elapsedMs, logger, traceId, userBucket } = args;
  try {
    const [totalUsage, steps] = await Promise.all([result.totalUsage, result.steps]);
    tracker.recordOrchestrator({
      usage: totalUsage as UsageLike,
      steps: steps as readonly { toolCalls: readonly unknown[] }[],
    });

    const finalized = await renderer.finalize({
      elapsedMs,
      totalTokens: tracker.totalTokens,
      toolCallCount: tracker.totalToolCalls,
      stepCount: tracker.totalSteps,
      traceId,
    });

    // Full model slug + hashed user bucket — never the raw user id (cardinality).
    const metricAttrs = { model: ORCHESTRATOR_MODEL, user: userBucket };
    recordDistribution("ai.turn.tokens", tracker.totalTokens, metricAttrs);
    recordDistribution("ai.turn.tool_calls", tracker.totalToolCalls, metricAttrs);
    recordDistribution("ai.turn.steps", tracker.totalSteps, metricAttrs);
    const costUsd = computeTurnCostUsd(tracker);
    recordDistribution("ai.turn.cost_usd", costUsd, metricAttrs);
    return { metadataError: undefined, finalized, costUsd };
  } catch (err) {
    countMetric("ai.turn.metadata_error");
    logger.warn("metadata collection failed", { reason: String(err) });
    const finalized = await renderer.finalize({
      elapsedMs,
      totalTokens: undefined,
      toolCallCount: 0,
      stepCount: 0,
      traceId,
    });
    return { metadataError: err, finalized, costUsd: undefined };
  }
}

/**
 * Persist the message-id → turn join consumed by the feedback reaction
 * handler — the primary reply and every overflow chunk map to the same turn.
 * Non-fatal by design: the reply has already been delivered, so an index
 * failure must not fail the turn — count it and continue.
 */
async function indexTurnMessages(args: {
  store: TurnMessageStore | undefined;
  messageIds: string[];
  record: TurnMessageRecord;
}): Promise<void> {
  try {
    const store = args.store ?? new TurnMessageStore();
    await Promise.all(args.messageIds.map((id) => store.set(id, args.record)));
  } catch {
    countMetric("ai.feedback.index_error");
  }
}
