import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { log } from "evlog";
import { createHook, getWorkflowMetadata } from "workflow";

import type { ContextSnapshot } from "@/bot/context-snapshot";
import type { ChatMessage, SerializedAgentContext } from "@/lib/ai/types";

import { ContextSnapshotStore } from "@/bot/context-snapshot";
import { ConversationStore } from "@/bot/store";
import { buildContextSnapshot } from "@/lib/ai/snapshot";
import { streamTurn } from "@/lib/ai/streaming";
import { addTurnUsage, emptyTurnUsage } from "@/lib/ai/turn-usage";
import { countMetric } from "@/lib/metrics";

import type { ChatHookEvent, ChatPayload } from "./types";

export type { ChatHookEvent, ChatPayload } from "./types";

/** Cap on accumulated user+assistant turns — 25 exchanges. Drops oldest pairs. */
const MAX_HISTORY_MESSAGES = 50;

// TODO: run the dropped messages through a small fast model (e.g. Haiku) and
// replace them with a compact summary assistant message, instead of throwing
// the context away entirely. Preserves continuity on long conversations at
// the cost of one extra round-trip per cap event.
function capHistory(messages: ChatMessage[]): void {
  if (messages.length <= MAX_HISTORY_MESSAGES) return;
  // Drop pairs (even count) so history always starts with a user message.
  const excess = messages.length - MAX_HISTORY_MESSAGES;
  messages.splice(0, excess + (excess % 2));
}

async function runTurn(
  channelId: string,
  messages: ChatMessage[],
  serializedContext: SerializedAgentContext,
) {
  "use step";
  const discord = new API(new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN!));
  return streamTurn(discord, channelId, messages, serializedContext);
}

async function persistSnapshot(
  channelId: string,
  threadId: string | undefined,
  snapshot: ContextSnapshot,
) {
  "use step";
  // Best-effort: snapshot persistence is diagnostic. A Redis blip should not
  // abort the chat workflow or hide a successful user-facing turn.
  try {
    await new ContextSnapshotStore().set(channelId, threadId, snapshot);
  } catch (err) {
    log.warn("workflow", `Snapshot persist failed for ${channelId}: ${String(err)}`);
    countMetric("workflow.chat.snapshot_error");
  }
}

async function emitMetric(name: string) {
  "use step";
  // Sentry's metrics buffer flushes via setTimeout, which isn't allowed in the
  // workflow runtime. Wrap every workflow-body metric call in a step so the
  // flush schedules in regular Node.
  countMetric(name);
}

async function cleanupConversation(channelId: string, threadId: string | undefined) {
  "use step";
  // Snapshot deletion is best-effort; only the ConversationStore delete is
  // load-bearing for starting a fresh workflow later.
  const [conversationResult, snapshotResult] = await Promise.allSettled([
    new ConversationStore().delete(channelId),
    new ContextSnapshotStore().delete(channelId, threadId),
  ]);
  if (snapshotResult.status === "rejected") {
    log.warn(
      "workflow",
      `Snapshot delete failed for ${channelId}: ${String(snapshotResult.reason)}`,
    );
    countMetric("workflow.chat.snapshot_cleanup_error");
  }
  if (conversationResult.status === "rejected") {
    throw conversationResult.reason;
  }
}

export async function chatWorkflow(payload: ChatPayload) {
  "use workflow";

  const { channelId, threadId, content, context } = payload;
  const { workflowRunId } = getWorkflowMetadata();

  log.info("workflow", `Chat started: ${workflowRunId}`);
  await emitMetric("workflow.chat.started");

  // Stable for the lifetime of this workflow — the conversation is pinned to
  // one Discord channel/thread and the pre-conversation message lead-in does
  // not change. Per-turn context takes these verbatim from the initial payload.
  const stableChannel = context.channel;
  const stableThread = context.thread;
  const stableRecentMessages = context.recentMessages;

  const messages: ChatMessage[] = [{ role: "user", content }];
  const first = await runTurn(channelId, messages, context);
  messages.push({ role: "assistant", content: first.text });
  capHistory(messages);

  let turnCount = 1;
  let totalUsage = addTurnUsage(emptyTurnUsage(), first.usage);
  await persistSnapshot(
    channelId,
    threadId,
    buildContextSnapshot({ context, messages, totalUsage, turnCount }),
  );

  using hook = createHook<ChatHookEvent>({ token: workflowRunId });

  for await (const event of hook) {
    if (event.type === "done") {
      log.info("workflow", `Chat ended by user: ${workflowRunId}`);
      await emitMetric("workflow.chat.ended");
      break;
    }
    if (!event.content) continue;

    log.info("workflow", `Follow-up from ${event.context.username}: ${workflowRunId}`);
    await emitMetric("workflow.chat.followup");

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
    capHistory(messages);
    turnCount += 1;
    totalUsage = addTurnUsage(totalUsage, turn.usage);
    await persistSnapshot(
      channelId,
      threadId,
      buildContextSnapshot({ context: turnContext, messages, totalUsage, turnCount }),
    );
  }

  await cleanupConversation(channelId, threadId);
  log.info("workflow", `Chat cleaned up: ${workflowRunId}`);
}
