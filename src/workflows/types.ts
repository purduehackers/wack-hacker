import type { SerializedAgentContext } from "@/lib/ai/types";
import type { TaskMeta } from "@/lib/tasks/types";

export interface ChatPayload {
  channelId: string;
  /** Thread ID when the conversation lives in a thread; used for context-snapshot keying. */
  threadId?: string;
  content: string;
  context: SerializedAgentContext;
  /**
   * W3C traceparent captured from the `chat.mention` span that initiated the
   * workflow. The workflow extracts it so every span it creates (workflow
   * body + steps) lives in the same trace as the originating mention.
   */
  traceparent?: string;
}

export type ChatHookEvent =
  | {
      type: "message";
      content: string;
      context: SerializedAgentContext;
      /**
       * W3C traceparent captured from the `chat.mention` / `chat.resume_hook`
       * span that fired this event. Lets the resumed turn's step spans join
       * the trace of the mention that triggered this specific turn, rather
       * than the workflow's initial mention.
       */
      traceparent?: string;
    }
  | { type: "done" };

/** Payload passed to start(). The `id` field on meta is ignored — the workflow sets it to its own runId. */
export interface TaskPayload {
  meta: Omit<TaskMeta, "id">;
}
