import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { log } from "evlog";
import { createHook, getWorkflowMetadata } from "workflow";

import type { SerializedAgentContext } from "@/lib/ai/types";

import { streamTurn } from "@/lib/ai/streaming";
import { ConversationStore } from "@/lib/bot/store";

import type { ChatPayload } from "./types";

export type { ChatPayload } from "./types";

interface ChatHookEvent {
  type: "message" | "done";
  content: string;
  authorId: string;
  authorUsername: string;
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

  await runTurn(channelId, content, context);

  using hook = createHook<ChatHookEvent>({ token: workflowRunId });

  for await (const event of hook) {
    if (event.type === "done") {
      log.info("workflow", `Chat ended by user: ${workflowRunId}`);
      break;
    }
    if (!event.content) continue;

    log.info("workflow", `Follow-up from ${event.authorUsername}: ${workflowRunId}`);
    await runTurn(channelId, event.content, context);
  }

  await cleanupConversation(channelId);
  log.info("workflow", `Chat cleaned up: ${workflowRunId}`);
}
