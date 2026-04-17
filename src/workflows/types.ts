import type { SerializedAgentContext } from "@/lib/ai/types";
import type { TaskMeta } from "@/lib/tasks/types";

export interface ChatPayload {
  channelId: string;
  content: string;
  context: SerializedAgentContext;
}

export type ChatHookEvent =
  | { type: "message"; content: string; context: SerializedAgentContext }
  | { type: "done" };

/** Payload passed to start(). The `id` field on meta is ignored — the workflow sets it to its own runId. */
export interface TaskPayload {
  meta: Omit<TaskMeta, "id">;
}
