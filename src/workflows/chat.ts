import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { log } from "evlog";
import { createHook, getWorkflowMetadata } from "workflow";

import type { RecentMessage, SerializedAgentContext } from "@/lib/ai/types";

import { ConversationStore } from "@/bot/store";
import { streamTurn } from "@/lib/ai/streaming";
import { countMetric } from "@/lib/metrics";

import type { ChatPayload } from "./types";

export type { ChatPayload } from "./types";

interface ChatHookEvent {
  type: "message" | "done";
  content: string;
  authorId: string;
  authorUsername: string;
  recentMessages: RecentMessage[] | undefined;
}

async function runTurn(
  channelId: string,
  content: string,
  serializedContext: SerializedAgentContext,
) {
  "use step";
  const discord = new API(new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN!));
  return streamTurn(discord, channelId, content, serializedContext);
}

async function cleanupConversation(channelId: string) {
  "use step";
  const store = new ConversationStore();
  await store.delete(channelId);
}

export async function chatWorkflow(payload: ChatPayload) {
  "use workflow";

  const { channelId, content, context } = payload;
  const { workflowRunId } = getWorkflowMetadata();

  log.info("workflow", `Chat started: ${workflowRunId}`);
  countMetric("workflow.chat.started");

  await runTurn(channelId, content, context);

  using hook = createHook<ChatHookEvent>({ token: workflowRunId });

  for await (const event of hook) {
    if (event.type === "done") {
      log.info("workflow", `Chat ended by user: ${workflowRunId}`);
      countMetric("workflow.chat.ended");
      break;
    }
    if (!event.content) continue;

    log.info("workflow", `Follow-up from ${event.authorUsername}: ${workflowRunId}`);
    countMetric("workflow.chat.followup");
    const turnContext = event.recentMessages
      ? { ...context, recentMessages: event.recentMessages }
      : context;
    await runTurn(channelId, event.content, turnContext);
  }

  await cleanupConversation(channelId);
  log.info("workflow", `Chat cleaned up: ${workflowRunId}`);
}
