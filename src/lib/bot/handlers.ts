import type { Message, Thread } from "chat";

import { resumeHook, start } from "workflow/api";

import type { ChatTurnPayload } from "../../server/workflows/types";
import type { ThreadState } from "./types";

import { bot } from ".";
import { chatWorkflow } from "../../server/workflows/chat";
import { AgentContext } from "../ai/context";

/** Start a new chat workflow for a first mention. */
async function startSession(thread: Thread<ThreadState>, message: Message) {
  const context = AgentContext.fromMessage(thread, message);

  const run = await start(chatWorkflow, [
    JSON.stringify({
      // @ts-ignore: https://github.com/vercel/chat/issues/241
      thread: thread.toJSON(),
      message: message.toJSON(),
      context,
    }),
  ]);

  await thread.setState({ runId: run.runId });
}

/** Route a message to an existing workflow or start a new session. */
async function routeTurn(thread: Thread<ThreadState>, message: Message) {
  const state = await thread.state;
  if (!state?.runId) {
    await startSession(thread, message);
    return;
  }

  await resumeHook<ChatTurnPayload>(state.runId, {
    message: message.toJSON(),
  });
}

/**
 * Register all bot event handlers.
 *
 * Must be called explicitly at startup — a bare side-effect import
 * gets tree-shaken by the bundler.
 */
export function registerHandlers() {
  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await routeTurn(thread, message);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await routeTurn(thread, message);
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
}
