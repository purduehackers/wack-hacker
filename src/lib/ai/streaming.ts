import type { API } from "@discordjs/core/http-only";

import { isTextUIPart, type UIMessage } from "ai";
import { log } from "evlog";

import { countMetric, recordDistribution, recordDuration } from "@/lib/metrics";

import type { Attachment, ChatMessage, SerializedAgentContext, SubagentMetrics } from "./types.ts";

import { AgentContext } from "./context.ts";
import { MessageRenderer } from "./message-renderer.ts";
import { createOrchestrator } from "./orchestrator.ts";

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
  taskId?: string,
): Promise<{ text: string }> {
  const agentCtx = AgentContext.fromJSON(serializedContext);
  const subagentMetrics: SubagentMetrics = { totalTokens: 0, toolCallCount: 0 };
  const agent = createOrchestrator(agentCtx, subagentMetrics);
  const renderer = new MessageRenderer(discord, channelId, { taskId });

  await renderer.init();

  log.info("streaming", `Turn started in ${channelId}`);

  const priorMessages = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const current = messages[messages.length - 1];
  const currentMessage = buildUserMessage(current.content, agentCtx.attachments);

  const startTime = Date.now();
  const result = await agent.stream({ messages: [...priorMessages, currentMessage] });

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta":
        await renderer.appendText(event.text);
        break;
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
    const orchestratorToolCalls = steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
    const totalTokens = (totalUsage.totalTokens ?? 0) + subagentMetrics.totalTokens;
    const toolCallCount = orchestratorToolCalls + subagentMetrics.toolCallCount;
    await renderer.finalize({
      elapsedMs,
      totalTokens,
      toolCallCount,
      stepCount: steps.length,
    });

    recordDistribution("ai.turn.tokens", totalTokens);
    recordDistribution("ai.turn.tool_calls", toolCallCount);
    recordDistribution("ai.turn.steps", steps.length);
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

  return { text: renderer.content };
}
