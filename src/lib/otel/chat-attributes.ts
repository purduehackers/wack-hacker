import type { SerializedAgentContext } from "@/lib/ai/types";

import type { ChatAttributes } from "./types.ts";

export type { ChatAttributes } from "./types.ts";

/**
 * Build chat attributes from a serialized context + the workflow run id. The
 * run id doubles as `chat.id` so a conversation maps to one Axiom query.
 */
export function buildChatAttributes(args: {
  workflowRunId: string;
  context: SerializedAgentContext;
  turnIndex?: number;
}): ChatAttributes {
  const { workflowRunId, context, turnIndex } = args;
  return {
    "chat.id": workflowRunId,
    "chat.channel_id": context.channel.id,
    ...(context.thread?.id ? { "chat.thread_id": context.thread.id } : {}),
    "chat.user_id": context.userId,
    ...(turnIndex !== undefined ? { "chat.turn_index": turnIndex } : {}),
  };
}
