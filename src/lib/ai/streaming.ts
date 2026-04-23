import type { API } from "@discordjs/core/http-only";

import { isTextUIPart, type UIMessage } from "ai";

import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDistribution, recordDuration } from "@/lib/metrics";
import { buildChatAttributes } from "@/lib/otel/chat-attributes";
import { withSpan } from "@/lib/otel/tracing";

import type {
  Attachment,
  ChatMessage,
  SerializedAgentContext,
  StreamTurnOptions,
  TurnUsage,
} from "./types.ts";

import { AgentContext } from "./context.ts";
import { MessageRenderer } from "./message-renderer.ts";
import { createOrchestrator } from "./orchestrator.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

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
): Promise<{ text: string; usage: TurnUsage }> {
  const { taskId, workflowRunId, turnIndex } = options;
  const chatAttrs = workflowRunId
    ? buildChatAttributes({ workflowRunId, context: serializedContext, turnIndex })
    : undefined;
  return withSpan(
    "chat.turn",
    {
      ...chatAttrs,
      "chat.channel_id": serializedContext.channel.id,
      "chat.user_id": serializedContext.userId,
      "chat.message_count": messages.length,
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
}): Promise<{ text: string; usage: TurnUsage }> {
  const { discord, channelId, messages, serializedContext, options, chatAttrs } = args;
  const { taskId, createAgent = createOrchestrator, workflowRunId, turnIndex } = options;
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

  await renderer.init();

  const priorMessages = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const current = messages[messages.length - 1];
  const currentMessage = buildUserMessage(current.content, agentCtx.attachments);

  const startTime = Date.now();
  const result = await agent.stream({ messages: [...priorMessages, currentMessage] });

  await renderStream(result.fullStream, renderer);

  const elapsedMs = Date.now() - startTime;
  const metadataError = await finalizeTurn({ result, tracker, renderer, elapsedMs, logger });

  countMetric("ai.turn.completed");
  recordDuration("ai.turn.duration", elapsedMs);

  logger.emit({
    outcome: metadataError ? "partial" : "ok",
    duration_ms: elapsedMs,
    text_length: renderer.content.length,
    tokens: tracker.totalTokens,
    tool_calls: tracker.totalToolCalls,
    steps: tracker.totalSteps,
  });

  return { text: renderer.content, usage: tracker.toTurnUsage() };
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

async function finalizeTurn(args: {
  result: { totalUsage: PromiseLike<unknown>; steps: PromiseLike<unknown> };
  tracker: TurnUsageTracker;
  renderer: MessageRenderer;
  elapsedMs: number;
  logger: ReturnType<typeof createWideLogger>;
}): Promise<unknown> {
  const { result, tracker, renderer, elapsedMs, logger } = args;
  try {
    const [totalUsage, steps] = await Promise.all([result.totalUsage, result.steps]);
    tracker.recordOrchestrator({
      usage: totalUsage as { inputTokens?: number; outputTokens?: number; totalTokens?: number },
      steps: steps as readonly { toolCalls: readonly unknown[] }[],
    });

    await renderer.finalize({
      elapsedMs,
      totalTokens: tracker.totalTokens,
      toolCallCount: tracker.totalToolCalls,
      stepCount: tracker.totalSteps,
    });

    recordDistribution("ai.turn.tokens", tracker.totalTokens);
    recordDistribution("ai.turn.tool_calls", tracker.totalToolCalls);
    recordDistribution("ai.turn.steps", tracker.totalSteps);
    return undefined;
  } catch (err) {
    countMetric("ai.turn.metadata_error");
    logger.warn("metadata collection failed", { reason: String(err) });
    await renderer.finalize({
      elapsedMs,
      totalTokens: undefined,
      toolCallCount: 0,
      stepCount: 0,
    });
    return err;
  }
}
