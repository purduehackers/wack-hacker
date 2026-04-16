import type { API } from "@discordjs/core/http-only";

import { isTextUIPart, type UIMessage } from "ai";
import { log } from "evlog";

import type { SerializedAgentContext, Attachment, SubagentMetrics } from "./types.ts";

import { AgentContext } from "./context.ts";
import { createOrchestrator } from "./orchestrator.ts";

const EDIT_INTERVAL_MS = 1500;
const MAX_LENGTH = 1900;

interface FooterMeta {
  elapsedMs: number;
  totalTokens: number | undefined;
  toolCallCount: number;
  stepCount: number;
}

export function formatFooter({ elapsedMs, totalTokens, toolCallCount, stepCount }: FooterMeta) {
  const parts = [`${(elapsedMs / 1000).toFixed(1)}s`];

  if (totalTokens != null) parts.push(`${totalTokens.toLocaleString("en-US")} tokens`);
  if (toolCallCount === 1) parts.push("1 tool call");
  else if (toolCallCount > 1) parts.push(`${toolCallCount} tool calls`);
  if (stepCount > 1) parts.push(`${stepCount} steps`);

  return `-# ${parts.join(" · ")}`;
}

export function truncateWithFooter(text: string, footer: string): string {
  const separator = "\n\n";
  const available = MAX_LENGTH - footer.length - separator.length;
  const body = text.length > available ? text.slice(0, available - 1) + "…" : text;
  return body + separator + footer;
}

export function truncate(text: string): string {
  return text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH) + "…" : text;
}

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

/** Compose the Discord message body from the orchestrator's current activity. */
function render(state: { text: string; activity: string | null; subagentPreview: string }): string {
  const parts: string[] = [];
  if (state.activity) parts.push(`-# ${state.activity}`);
  if (state.subagentPreview) parts.push(`> ${state.subagentPreview.replaceAll("\n", "\n> ")}`);
  if (state.text) parts.push(state.text);
  return truncate(parts.join("\n\n") || "> Thinking...");
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
  const msg = await discord.channels.createMessage(channelId, { content: "> Thinking..." });

  log.info("streaming", `Turn started in ${channelId}`);

  const startTime = Date.now();
  const result = await agent.stream(buildPrompt(content, agentCtx.attachments));

  const state = { text: "", activity: null as string | null, subagentPreview: "" };
  let lastEdit = Date.now();
  let lastRendered = "> Thinking...";

  const flush = async () => {
    if (Date.now() - lastEdit < EDIT_INTERVAL_MS) return;
    const content = render(state);
    if (content === lastRendered) return;
    lastEdit = Date.now();
    lastRendered = content;
    try {
      await discord.channels.editMessage(channelId, msg.id, { content });
    } catch (err) {
      log.warn("streaming", `Edit failed mid-stream: ${String(err)}`);
    }
  };

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta":
        state.text += event.text;
        state.activity = null;
        state.subagentPreview = "";
        await flush();
        break;
      case "tool-input-start":
        state.activity = `Calling \`${event.toolName}\`...`;
        state.subagentPreview = "";
        await flush();
        break;
      case "tool-result":
        // Subagent delegation tools yield UIMessage snapshots as preliminary
        // results. Pull out the latest text so the user sees subagent progress.
        if (event.preliminary && event.output && typeof event.output === "object") {
          const preview = previewSubagentText(event.output as UIMessage);
          if (preview) {
            state.subagentPreview = preview;
            await flush();
          }
        } else {
          state.activity = null;
          state.subagentPreview = "";
        }
        break;
      default:
        break;
    }
  }

  const elapsedMs = Date.now() - startTime;
  let footer: string;
  try {
    const [totalUsage, steps] = await Promise.all([result.totalUsage, result.steps]);
    const orchestratorToolCalls = steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
    footer = formatFooter({
      elapsedMs,
      totalTokens: (totalUsage.totalTokens ?? 0) + subagentMetrics.totalTokens,
      toolCallCount: orchestratorToolCalls + subagentMetrics.toolCallCount,
      stepCount: steps.length,
    });
  } catch (err) {
    log.warn("streaming", `Failed to collect metadata: ${String(err)}`);
    footer = formatFooter({ elapsedMs, totalTokens: undefined, toolCallCount: 0, stepCount: 0 });
  }

  if (taskId) footer += `\n-# Task: ${taskId}`;

  const finalText = state.text || "I didn't have anything to say.";
  const final = truncateWithFooter(finalText, footer);
  try {
    await discord.channels.editMessage(channelId, msg.id, { content: final });
  } catch (err) {
    log.warn("streaming", `Final edit failed, sending new message: ${String(err)}`);
    await discord.channels.createMessage(channelId, { content: final });
  }

  log.info("streaming", `Turn complete, ${state.text.length} chars, ${elapsedMs}ms`);

  return { text: state.text };
}
