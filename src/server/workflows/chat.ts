import { Message, type Thread } from "chat";
import { createHook, getWorkflowMetadata } from "workflow";

import type { ThreadState } from "../../lib/bot/types";
import type { ChatTurnPayload } from "./types";

async function loadBot() {
  const { bot } = await import("../../lib/bot");
  await bot.initialize();
  return bot;
}

export async function chatSession(payload: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  const { thread, message } = await parsePayload(payload);
  using hook = createHook<ChatTurnPayload>({ token: workflowRunId });
  await reply(
    thread,
    "Session started. Reply in this thread and send `done` when you want to stop.",
  );
  if (!(await handleTurn(thread, message))) {
    return;
  }
  for await (const event of hook) {
    const next = Message.fromJSON(event.message);
    if (!(await handleTurn(thread, next))) {
      return;
    }
  }
}

async function parsePayload(payload: string) {
  "use step";
  const bot = await loadBot();
  return JSON.parse(payload, bot.reviver()) as {
    thread: Thread<ThreadState>;
    message: Message;
  };
}

async function reply(thread: Thread<ThreadState>, text: string) {
  "use step";
  await loadBot();
  await thread.post(text);
}

async function close(thread: Thread<ThreadState>) {
  "use step";
  await loadBot();
  await thread.post("Session closed.");
  await thread.unsubscribe();
  await thread.setState({}, { replace: true });
}

async function generateReply(text: string) {
  "use step";
  // Replace this with AI SDK calls, database work, or other business logic.
  return `You said: ${text}`;
}

async function handleTurn(thread: Thread<ThreadState>, message: Message) {
  const text = message.text.trim();
  if (text.toLowerCase() === "done") {
    await close(thread);
    return false;
  }
  const response = await generateReply(text);
  await reply(thread, response);
  return true;
}
