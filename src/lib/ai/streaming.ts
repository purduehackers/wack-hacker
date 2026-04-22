import type { API } from "@discordjs/core/http-only";

import { isTextUIPart, type UIMessage } from "ai";
import { log } from "evlog";

import { countMetric, recordDistribution, recordDuration } from "@/lib/metrics";

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
  const { taskId, createAgent = createOrchestrator } = options;
  const agentCtx = AgentContext.fromJSON(serializedContext);
  const tracker = new TurnUsageTracker();
  // The `OrchestratorFactory` return type is a structural subset of the real
  // ToolLoopAgent, so we cast back to the concrete agent type here to keep the
  // stream-event discriminated union typed.
  const agent = createAgent(agentCtx, tracker) as ReturnType<typeof createOrchestrator>;
  const renderer = new MessageRenderer(discord, channelId, { taskId });

  await renderer.init();

  log.info("streaming", `Turn started in ${channelId}`);

  const priorMessages = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const current = messages[messages.length - 1];
  const currentMessage = buildUserMessage(current.content, agentCtx.attachments);

  const startTime = Date.now();
  const result = await agent.stream({ messages: [...priorMessages, currentMessage] });

  let lastTextId: string | undefined;

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta": {
        const delta =
          lastTextId !== undefined && event.id !== lastTextId ? "\n\n" + event.text : event.text;
        lastTextId = event.id;
        await renderer.appendText(delta);
        break;
      }
      case "tool-input-start":
        await renderer.showToolCall(event.toolName);
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

  const elapsedMs = Date.now() - startTime;
  try {
    const [totalUsage, steps] = await Promise.all([result.totalUsage, result.steps]);
    tracker.recordOrchestrator({ usage: totalUsage, steps });

    await renderer.finalize({
      elapsedMs,
      totalTokens: tracker.totalTokens,
      toolCallCount: tracker.totalToolCalls,
      stepCount: tracker.totalSteps,
    });

    recordDistribution("ai.turn.tokens", tracker.totalTokens);
    recordDistribution("ai.turn.tool_calls", tracker.totalToolCalls);
    recordDistribution("ai.turn.steps", tracker.totalSteps);
  } catch (err) {
    log.warn("streaming", `Failed to collect metadata: ${String(err)}`);
    countMetric("ai.turn.metadata_error");
    await renderer.finalize({
      elapsedMs,
      totalTokens: undefined,
      toolCallCount: 0,
      stepCount: 0,
    });
  }

  countMetric("ai.turn.completed");
  recordDuration("ai.turn.duration", elapsedMs);

  log.info("streaming", `Turn complete, ${renderer.content.length} chars, ${elapsedMs}ms`);

  return { text: renderer.content, usage: tracker.toTurnUsage() };
}
