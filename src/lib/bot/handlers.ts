import type { Message, Thread } from "chat";

import { resumeHook, start } from "workflow/api";

import type { ChatTurnPayload } from "../../server/workflows/types";
import type { ThreadState } from "./types";

import { bot } from ".";
import { chatSession } from "../../server/workflows/chat";

async function startSession(thread: Thread<ThreadState>, message: Message) {
  const run = await start(chatSession, [
    JSON.stringify({
      thread: thread.toJSON(),
      message: message.toJSON(),
    }),
  ]);
  await thread.setState({ runId: run.runId });
}

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

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await routeTurn(thread, message);
});

bot.onSubscribedMessage(async (thread, message) => {
  await routeTurn(thread, message);
});
