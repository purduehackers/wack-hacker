import type { API } from "@discordjs/core/http-only";

import { isTextUIPart, type UIMessage } from "ai";
import { log } from "evlog";

import { countMetric, recordDistribution, recordDuration } from "@/lib/metrics";

import type { SerializedAgentContext, Attachment, SubagentMetrics } from "./types.ts";

import { AgentContext } from "./context.ts";
import { MessageRenderer } from "./message-renderer.ts";
import { createOrchestrator } from "./orchestrator.ts";

export { MessageRenderer } from "./message-renderer.ts";

export function buildPrompt(content: string, attachments?: Attachment[]) {
  if (!attachments?.length) return { prompt: content };

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: URL }
    | { type: "file"; data: URL; filename: string; mediaType: string }
  > = [{ type: "text", text: content }];

  for (const a of attachments) {
    if (a.contentType?.startsWith("image/")) {
      userContent.push({ type: "image", image: new URL(a.url) });
    } else {
      userContent.push({
        type: "file",
        data: new URL(a.url),
        filename: a.filename,
        mediaType: a.contentType ?? "application/octet-stream",
      });
    }
  }

  return { messages: [{ role: "user" as const, content: userContent }] };
}

/** Extract the latest text from a subagent's UIMessage for inline preview. */
function previewSubagentText(message: UIMessage): string {
  const last = message.parts.findLast(isTextUIPart);
  return last?.text ?? "";
}

export async function streamTurn(
  discord: API,
  channelId: string,
  content: string,
  serializedContext: SerializedAgentContext,
  taskId?: string,
): Promise<{ text: string }> {
  const agentCtx = AgentContext.fromJSON(serializedContext);
  const subagentMetrics: SubagentMetrics = { totalTokens: 0, toolCallCount: 0 };
  const agent = createOrchestrator(agentCtx, subagentMetrics);
  const renderer = new MessageRenderer(discord, channelId, { taskId });

  await renderer.init();

  log.info("streaming", `Turn started in ${channelId}`);

  const startTime = Date.now();
  const result = await agent.stream(buildPrompt(content, agentCtx.attachments));

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
