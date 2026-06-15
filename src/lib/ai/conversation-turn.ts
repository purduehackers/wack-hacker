import { generateText } from "ai";

import { countMetric } from "@/lib/metrics";

import type { ChatMessage } from "./types.ts";

/** Cap on accumulated user+assistant turns — 25 exchanges. */
const MAX_HISTORY_MESSAGES = 50;

/**
 * Stored assistant turns are clipped to this many chars. The full text was
 * already delivered to Discord; history only needs enough for continuity.
 */
const MAX_STORED_ASSISTANT_CHARS = 4000;

/** Cheap model that compacts dropped history into one summary message. */
const HISTORY_SUMMARY_MODEL = "openai/gpt-5.4-mini";

export function truncateForHistory(text: string): string {
  if (text.length <= MAX_STORED_ASSISTANT_CHARS) return text;
  return `${text.slice(0, MAX_STORED_ASSISTANT_CHARS)}\n[truncated]`;
}

/**
 * Compact a dropped history prefix into one summary string. A plain async
 * function (no workflow step directive) so non-workflow callers — the chat
 * simulator — can reuse it directly; the workflow wraps it in a `"use step"`
 * for durability (see `summarizeHistory` in `workflows/chat.ts`).
 */
export async function summarizeDroppedHistory(dropped: ChatMessage[]): Promise<string> {
  const transcript = dropped.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const { text } = await generateText({
    model: HISTORY_SUMMARY_MODEL,
    prompt:
      "Summarize this conversation excerpt in under 200 words. Preserve concrete facts, decisions, names, links, and any commitments the assistant made. Write it as context the assistant will rely on to continue the conversation.\n\n" +
      transcript,
  });
  return text;
}

/**
 * Keep history under the cap by replacing the dropped prefix with one
 * cheap-model summary message. Falls back to plain dropping when the summary
 * fails — losing old context beats failing the conversation.
 *
 * `summarize` is injected so the workflow can pass its durable `"use step"`
 * wrapper while the simulator passes the plain {@link summarizeDroppedHistory}.
 */
export async function capHistory(
  messages: ChatMessage[],
  summarize: (dropped: ChatMessage[]) => Promise<string> = summarizeDroppedHistory,
): Promise<void> {
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
    const summary = await summarize(dropped);
    messages.splice(0, dropCount, {
      role: "user",
      content: `[Summary of ${dropped.length} earlier messages, compacted to save space]\n${summary}`,
    });
  } catch {
    countMetric("workflow.chat.history_summary_failed");
    messages.splice(0, dropCount);
  }
}

/**
 * Append the turn's wall-clock time to a followup user message. The system
 * prompt's `{{NOW_ISO}}`/`{{DATE}}` are pinned to the first turn so the
 * prompt stays byte-stable across turns; this stamp is how later turns learn
 * the real current time. It is persisted into conversation history so the
 * replayed prefix stays byte-stable too.
 */
export function stampCurrentTime(content: string, nowISO: string | undefined): string {
  return nowISO ? `${content}\n\n[current time: ${nowISO}]` : content;
}
