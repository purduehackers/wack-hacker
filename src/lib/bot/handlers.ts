import type { Message, Thread } from "chat";

import { resumeHook, start } from "workflow/api";

import type { ChatTurnPayload } from "../../server/workflows/types";
import type { ThreadState } from "./types";

import { bot } from ".";
import { chatWorkflow } from "../../server/workflows/chat";
import { AgentContext } from "../ai/context";

/** Start a new chat workflow for a first mention. */
async function startSession(thread: Thread<ThreadState>, message: Message) {
  console.log("[handlers] startSession", { threadId: thread.id });
  const context = AgentContext.fromMessage(thread, message);
  console.log("[handlers] context created", { role: context.role });

  const run = await start(chatWorkflow, [
    JSON.stringify({
      // @ts-ignore: https://github.com/vercel/chat/issues/241
      thread: thread.toJSON(),
      message: message.toJSON(),
      context,
    }),
  ]);
  console.log("[handlers] workflow started", { runId: run.runId });

  await thread.setState({ runId: run.runId });
}

/** Route a message to an existing workflow or start a new session. */
async function routeTurn(thread: Thread<ThreadState>, message: Message) {
  const state = await thread.state;
  console.log("[handlers] routeTurn", { threadId: thread.id, state });
  if (!state?.runId) {
    await startSession(thread, message);
    return;
  }

  await resumeHook<ChatTurnPayload>(state.runId, {
    message: message.toJSON(),
  });
}

bot.onNewMention(async (thread, message) => {
  try {
    console.log("[handlers] onNewMention", { threadId: thread.id, text: message.text });
    await thread.subscribe();
    console.log("[handlers] subscribed");
    await routeTurn(thread, message);
    console.log("[handlers] routeTurn complete");
  } catch (err) {
    console.error("[handlers] onNewMention error:", err);
  }
});

bot.onSubscribedMessage(async (thread, message) => {
  try {
    console.log("[handlers] onSubscribedMessage", { threadId: thread.id, text: message.text });
    await routeTurn(thread, message);
    console.log("[handlers] routeTurn complete");
  } catch (err) {
    console.error("[handlers] onSubscribedMessage error:", err);
  }
});

/**
 * Catch-all action handler for approval card buttons.
 *
 * Button ids are encoded as `approval:{approve|deny}:{hookToken}` because
 * the Discord adapter maps `<Button id>` to `custom_id` and discards the
 * `value` prop entirely.
 */
bot.onAction(async (event) => {
  const match = event.actionId.match(/^approval:(approve|deny):(.+)$/);
  if (!match) return;

  const approved = match[1] === "approve";
  const token = match[2];
  try {
    await resumeHook(`approval:${token}`, {
      approved,
      userId: event.user.userId,
    });
  } catch {
    // Hook may not exist or already resolved
  }
});
