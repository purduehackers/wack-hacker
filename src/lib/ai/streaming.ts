import type { API } from "@discordjs/core/http-only";

import { trace } from "@opentelemetry/api";
import { isTextUIPart, type UIMessage } from "ai";
import { FatalError } from "workflow";

import type { TurnMessageRecord } from "@/bot/types";

import { TurnMessageStore } from "@/bot/turn-message-store";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDistribution, recordDuration } from "@/lib/metrics";
import { buildChatAttributes } from "@/lib/otel/chat-attributes";
import { setActiveSpanAttributes, withSpan } from "@/lib/otel/tracing";

import type { BudgetState } from "./policy/index.ts";
import type {
  Attachment,
  ChatMessage,
  OrchestratorFactory,
  OrchestratorUsage,
  SerializedAgentContext,
  StreamTurnOptions,
  StreamTurnResult,
} from "./types.ts";

import { ORCHESTRATOR_FALLBACK_MODELS, ORCHESTRATOR_MODEL } from "./constants.ts";
import { AgentContext } from "./context.ts";
import { MessageRenderer } from "./message-renderer.ts";
import { estimateModelCostUsd, warmModelCatalog } from "./models-dev.ts";
import { createOrchestrator } from "./orchestrator.ts";
import { readBudgetState, recordTurnTokens } from "./policy/index.ts";
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
  // Warm the model-pricing catalog now so cost attribution at finalize reads
  // from cache; fire-and-forget, so a cold-start turn never blocks on the
  // network (cost is simply omitted until the catalog lands).
  warmModelCatalog();
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
  } = options;
  const agentCtx = AgentContext.fromJSON(serializedContext);
  const tracker = new TurnUsageTracker();
  const budget = await readBudgetState({ userId: agentCtx.userId, role: agentCtx.role });
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
  const traceId = trace.getActiveSpan()?.spanContext().traceId;

  let streamed: StreamWithFallbackResult;
  try {
    streamed = await streamWithFallback({
      createAgent,
      agentCtx,
      tracker,
      budget,
      chatAttrs,
      renderer,
      messages: [...priorMessages, currentMessage],
      logger,
    });
  } catch (err) {
    throw await failTurn({ err, renderer, logger, traceId, startTime });
  }
  const { result, modelUsed } = streamed;

  const elapsedMs = Date.now() - startTime;
  // Finalize runs after the stream — tools already executed, so a finalize
  // failure (e.g. Discord down for both the edit and its createMessage
  // fallback) must be classified fatal too, or WDK would replay the whole
  // side-effectful turn.
  let finalizeResult: FinalizeResult;
  try {
    finalizeResult = await finalizeTurn({
      result,
      tracker,
      renderer,
      elapsedMs,
      logger,
      traceId,
      modelUsed,
    });
  } catch (err) {
    throw await failTurn({ err, renderer, logger, traceId, startTime });
  }
  return finishTurn({
    finalizeResult,
    tracker,
    renderer,
    logger,
    elapsedMs,
    modelUsed,
    traceId,
    userId: serializedContext.userId,
    channelId,
    workflowRunId,
    turnMessageStore: options.turnMessageStore,
  });
}

/**
 * Post-stream tail of a successful turn: emit the metrics + span/wide-event
 * totals, persist the message → turn index for feedback, and fold tokens into
 * the daily budget. Split out so runStreamTurn stays focused on the stream.
 */
async function finishTurn(args: {
  finalizeResult: FinalizeResult;
  tracker: TurnUsageTracker;
  renderer: MessageRenderer;
  logger: ReturnType<typeof createWideLogger>;
  elapsedMs: number;
  modelUsed: string;
  traceId: string | undefined;
  userId: string;
  channelId: string;
  workflowRunId: string | undefined;
  turnMessageStore: TurnMessageStore | undefined;
}): Promise<StreamTurnResult> {
  const { finalizeResult, tracker, renderer, logger, elapsedMs, modelUsed } = args;
  const { metadataError, finalized, costUsd } = finalizeResult;

  countMetric("ai.turn.completed");
  recordDuration("ai.turn.duration", elapsedMs);

  const turnResult = emitTurnSuccess({
    tracker,
    renderer,
    logger,
    elapsedMs,
    modelUsed,
    messageId: finalized.messageId,
    metadataError,
    costUsd,
  });

  await indexTurnReplies({
    store: args.turnMessageStore,
    messageIds: [finalized.messageId, ...finalized.overflowIds],
    record: {
      chatId: args.workflowRunId,
      traceId: args.traceId,
      channelId: args.channelId,
      userId: args.userId,
    },
  });

  // Fold this turn's tokens into the subject's daily budget counter for all
  // roles — enforcement is role-gated in decide(), but the data is universal.
  await recordTurnTokens(args.userId, turnResult.usage.totalTokens);
  return turnResult;
}

/**
 * Persist the message-id → turn join the feedback reaction handler reads — the
 * primary reply and every overflow chunk map to the same turn. Non-fatal: the
 * reply is already delivered, so an index failure must not fail the turn.
 */
async function indexTurnReplies(args: {
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

/** Mirror per-turn totals onto the span + wide event and build the result. */
function emitTurnSuccess(args: {
  tracker: TurnUsageTracker;
  renderer: MessageRenderer;
  logger: ReturnType<typeof createWideLogger>;
  elapsedMs: number;
  modelUsed: string;
  messageId: string;
  metadataError: unknown;
  costUsd: number | undefined;
}): StreamTurnResult {
  const { tracker, renderer, logger, elapsedMs, modelUsed, messageId, metadataError, costUsd } =
    args;
  const usage = tracker.toTurnUsage();
  const { provider, model } = parseModelSlug(modelUsed);

  // Mirror the per-turn totals onto the active chat.turn span so operators can
  // query the trace directly without joining against wide events. Model
  // identity is rewritten too — a fallback retry means the span's initial
  // ai.model attribute no longer reflects what actually ran. OTEL drops
  // undefined attribute values, so a provider-less slug needs no guard.
  setActiveSpanAttributes({
    "ai.model": model,
    "ai.provider": provider,
    "ai.input_tokens": usage.inputTokens,
    "ai.output_tokens": usage.outputTokens,
    "ai.cache_read_tokens": tracker.cacheReadTokens,
    "ai.cache_write_tokens": tracker.cacheWriteTokens,
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
    text_length: renderer.content.length,
    tokens: usage.totalTokens,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: tracker.cacheReadTokens,
    cache_write_tokens: tracker.cacheWriteTokens,
    subagent_tokens: usage.subagentTokens,
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
    tool_calls: usage.toolCallCount,
    tool_names: usage.toolNames,
    steps: usage.stepCount,
    model: modelUsed,
    discord_message_id: messageId,
  });

  return {
    text: renderer.content,
    usage,
    discordMessageId: messageId,
    model: modelUsed,
  };
}

/** User-facing failure notice; the trace id lets users report a specific turn. */
export function turnFailureNotice(traceId: string | undefined): string {
  return traceId
    ? `Something went wrong — try again. Trace: \`${traceId}\``
    : "Something went wrong — try again.";
}

/**
 * Terminal failure path for a turn: show the user a failure notice (with the
 * trace id for correlation), emit the error wide event, and return the
 * FatalError for the caller to throw. FatalError tells the workflow step not
 * to replay the turn — it may have side effects behind it.
 */
async function failTurn(args: {
  err: unknown;
  renderer: MessageRenderer;
  logger: ReturnType<typeof createWideLogger>;
  traceId: string | undefined;
  startTime: number;
}): Promise<FatalError> {
  const { err, renderer, logger, traceId, startTime } = args;
  const error = err as Error;
  countMetric("ai.turn.failed");
  await renderer.renderFailure(turnFailureNotice(traceId));
  logger.emit({
    outcome: "error",
    duration_ms: Date.now() - startTime,
    error_class: error?.name ?? "unknown",
    error_message: error?.message ?? String(err),
  });
  return new FatalError(`chat turn failed: ${String(err)}`);
}

interface StreamWithFallbackResult {
  result: Awaited<ReturnType<ReturnType<typeof createOrchestrator>["stream"]>>;
  /** Gateway slug of the model that produced the successful stream. */
  modelUsed: string;
}

/**
 * Stream the turn, retrying once per fallback model on a terminal provider
 * error — but only while no tool has run. Tool executions are external side
 * effects (GitHub/Linear/Discord writes); replaying the turn after one would
 * duplicate them.
 */
async function streamWithFallback(args: {
  createAgent: OrchestratorFactory;
  agentCtx: AgentContext;
  tracker: TurnUsageTracker;
  budget: BudgetState | null;
  chatAttrs: ReturnType<typeof buildChatAttributes> | undefined;
  renderer: MessageRenderer;
  messages: NonNullable<Parameters<ReturnType<typeof createOrchestrator>["stream"]>[0]["messages"]>;
  logger: ReturnType<typeof createWideLogger>;
}): Promise<StreamWithFallbackResult> {
  const { createAgent, agentCtx, tracker, budget, chatAttrs, renderer, messages, logger } = args;
  const models = [ORCHESTRATOR_MODEL, ...ORCHESTRATOR_FALLBACK_MODELS];
  let toolCallSeen = false;

  for (let attempt = 0; ; attempt++) {
    const modelUsed = models[attempt];
    // The `OrchestratorFactory` return type is a structural subset of the
    // real ToolLoopAgent, so we cast back to the concrete agent type here to
    // keep the stream-event discriminated union typed.
    const agent = createAgent(
      agentCtx,
      tracker,
      chatAttrs,
      modelUsed,
      budget,
    ) as unknown as ReturnType<typeof createOrchestrator>;
    try {
      const result = await agent.stream({ messages });
      const outcome = await renderStream(result.fullStream, renderer);
      toolCallSeen ||= outcome.toolCallSeen;
      if (outcome.terminalError !== undefined) throw outcome.terminalError;
      return { result, modelUsed };
    } catch (err) {
      const lastModel = attempt >= models.length - 1;
      if (lastModel || toolCallSeen) throw err;
      countMetric("ai.turn.model_fallback", { from: modelUsed });
      logger.warn("stream failed, retrying on fallback model", {
        reason: String(err),
        from: modelUsed,
        to: models[attempt + 1],
      });
      renderer.reset();
    }
  }
}

interface StreamRenderOutcome {
  /**
   * Error carried by a terminal `error` part. The AI SDK ends the stream with
   * one of these instead of throwing, so without surfacing it the turn would
   * finish looking normal with no text.
   */
  terminalError: unknown;
  /** True once any tool call started — external side effects may have run. */
  toolCallSeen: boolean;
}

interface StreamEventLike {
  type: string;
  id?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  preliminary?: boolean;
  output?: unknown;
  error?: unknown;
}

async function renderToolResult(event: StreamEventLike, renderer: MessageRenderer): Promise<void> {
  if (event.preliminary && event.output && typeof event.output === "object") {
    const preview = previewSubagentText(event.output as UIMessage);
    if (preview) await renderer.showSubagentPreview(event.toolCallId ?? "unknown", preview);
  } else {
    renderer.clearActivity(event.toolCallId);
  }
}

async function renderToolError(event: StreamEventLike, renderer: MessageRenderer): Promise<void> {
  countMetric("ai.turn.tool_error", { tool: event.toolName ?? "unknown" });
  renderer.clearActivity(event.toolCallId);
  if (event.toolName) await renderer.showToolFailed(event.toolName);
}

async function renderStream(
  fullStream: AsyncIterable<unknown>,
  renderer: MessageRenderer,
): Promise<StreamRenderOutcome> {
  let lastTextId: string | undefined;
  let terminalError: unknown;
  let toolCallSeen = false;
  for await (const raw of fullStream) {
    const event = raw as StreamEventLike;
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
        toolCallSeen = true;
        if (event.toolName) await renderer.showToolCall(event.toolName);
        break;
      case "tool-result":
        await renderToolResult(event, renderer);
        break;
      case "tool-error":
        await renderToolError(event, renderer);
        break;
      case "error":
        terminalError = event.error ?? new Error("stream emitted an error part");
        break;
      default:
        break;
    }
  }
  return { terminalError, toolCallSeen };
}

interface FinalizeResult {
  metadataError: unknown;
  finalized: { messageId: string; overflowIds: string[] };
  /** Whole-turn USD cost (orchestrator + subagents); undefined when the pricing
   * catalog isn't warm yet or the orchestrator model isn't priced. */
  costUsd: number | undefined;
}

async function finalizeTurn(args: {
  result: { totalUsage: PromiseLike<unknown>; steps: PromiseLike<unknown> };
  tracker: TurnUsageTracker;
  renderer: MessageRenderer;
  elapsedMs: number;
  logger: ReturnType<typeof createWideLogger>;
  traceId: string | undefined;
  modelUsed: string;
}): Promise<FinalizeResult> {
  const { result, tracker, renderer, elapsedMs, logger, traceId, modelUsed } = args;
  try {
    const [totalUsage, steps] = await Promise.all([result.totalUsage, result.steps]);
    tracker.recordOrchestrator({
      usage: totalUsage as OrchestratorUsage,
      steps: steps as readonly { toolCalls: readonly unknown[] }[],
    });

    const finalized = await renderer.finalize({
      elapsedMs,
      totalTokens: tracker.totalTokens,
      toolCallCount: tracker.totalToolCalls,
      stepCount: tracker.totalSteps,
      traceId,
    });

    recordDistribution("ai.turn.tokens", tracker.totalTokens);
    recordDistribution("ai.turn.tool_calls", tracker.totalToolCalls);
    recordDistribution("ai.turn.steps", tracker.totalSteps);
    recordDistribution("ai.turn.cache_read_tokens", tracker.cacheReadTokens);
    recordDistribution("ai.turn.cache_write_tokens", tracker.cacheWriteTokens);

    // Whole-turn cost = orchestrator (priced at the model that actually ran,
    // including a fallback) + each subagent's own-model cost summed in the
    // tracker. Gated on the orchestrator price being known: that's the base of
    // every turn, so omit the metric rather than report a subagent-only total.
    const orchestratorUsage = tracker.toTurnUsage();
    const orchestratorCostUsd = estimateModelCostUsd(modelUsed, {
      inputTokens: orchestratorUsage.inputTokens,
      outputTokens: orchestratorUsage.outputTokens,
    });
    const costUsd =
      orchestratorCostUsd === undefined ? undefined : orchestratorCostUsd + tracker.subagentCostUsd;
    if (costUsd !== undefined) recordDistribution("ai.turn.cost_usd", costUsd);

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
