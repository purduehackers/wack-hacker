import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { log } from "evlog";
import { createHook, getWorkflowMetadata } from "workflow";

import type { ChatMessage, SerializedAgentContext } from "@/lib/ai/types";

import { ConversationStore } from "@/bot/store";
import { streamTurn } from "@/lib/ai/streaming";
import { countMetric } from "@/lib/metrics";

import type { ChatHookEvent, ChatPayload } from "./types";

export type { ChatHookEvent, ChatPayload } from "./types";

async function runTurn(
  channelId: string,
  messages: ChatMessage[],
  serializedContext: SerializedAgentContext,
) {
  "use step";
  const discord = new API(new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN!));
  return streamTurn(discord, channelId, messages, serializedContext);
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

  // Stable for the lifetime of this workflow — the conversation is pinned to
  // one Discord channel/thread and the pre-conversation message lead-in does
  // not change. Per-turn context takes these verbatim from the initial payload.
  const stableChannel = context.channel;
  const stableThread = context.thread;
  const stableRecentMessages = context.recentMessages;

  const messages: ChatMessage[] = [{ role: "user", content }];
  const first = await runTurn(channelId, messages, context);
  messages.push({ role: "assistant", content: first.text });

  using hook = createHook<ChatHookEvent>({ token: workflowRunId });

  for await (const event of hook) {
    if (event.type === "done") {
      log.info("workflow", `Chat ended by user: ${workflowRunId}`);
      countMetric("workflow.chat.ended");
      break;
    }
    if (!event.content) continue;

    log.info("workflow", `Follow-up from ${event.context.username}: ${workflowRunId}`);
    countMetric("workflow.chat.followup");

    // Merge the fresh per-turn identity from the event with the stable
    // location + lead-in pinned at workflow start.
    const turnContext: SerializedAgentContext = {
      ...event.context,
      channel: stableChannel,
      thread: stableThread,
      recentMessages: stableRecentMessages,
    };

    messages.push({ role: "user", content: event.content });
    const turn = await runTurn(channelId, messages, turnContext);
    messages.push({ role: "assistant", content: turn.text });
  }

  await cleanupConversation(channelId);
  log.info("workflow", `Chat cleaned up: ${workflowRunId}`);
}
