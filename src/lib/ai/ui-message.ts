import type { UIMessage } from "ai";

/**
 * Build a single-text-part assistant `UIMessage` — the chunk shape streaming
 * tools and subagents yield. Pass a stable `id` when one matters (dedup, fixed
 * markers); otherwise a unique one is generated.
 */
export function textMessage(text: string, id?: string): UIMessage {
  return {
    id: id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}
