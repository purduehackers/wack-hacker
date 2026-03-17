import type { UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { Message, type Thread } from "chat";
import { createHook, getWritable, getWorkflowMetadata } from "workflow";

import type { SerializedAgentContext } from "../../lib/ai/context/types";
import type { ThreadState } from "../../lib/bot/types";
import type { ChatTurnPayload } from "./types";

import { SYSTEM_PROMPT, SYSTEM_PUBLIC_PROMPT } from "../../lib/ai/chat/prompts/constants";
import { createChatTools } from "../../lib/ai/chat/tools";
import { AgentContext } from "../../lib/ai/context";
import { DiscordRole } from "../../lib/ai/context/constants";

/**
 * Multi-turn chat workflow.
 *
 * The raw payload string is passed to each step that needs Chat SDK objects,
 * avoiding serialization issues — Chat SDK classes require the bot singleton
 * which isn't available in the workflow runtime's serializer.
 */
export async function chatWorkflow(payload: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const { context, messageText } = await extractContext(payload);

  const isPublic = context.role === DiscordRole.Public;
  const rawPrompt = isPublic ? SYSTEM_PUBLIC_PROMPT : SYSTEM_PROMPT;
  const system = AgentContext.fromJSON(context).buildInstructions(rawPrompt);

  const writable = getWritable<UIMessageChunk>();
  const agent = new DurableAgent({
    model: "anthropic/claude-sonnet-4",
    system,
    tools: createChatTools(context),
  });

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: messageText },
  ];

  const firstReply = await runTurn(agent, messages, writable);
  await postToThread(payload, firstReply);

  using hook = createHook<ChatTurnPayload>({ token: workflowRunId });
  for await (const event of hook) {
    const next = await deserializeMessage(event.message);
    const text = next.text.trim();

    if (text.toLowerCase() === "done") {
      await closeSession(payload);
      break;
    }

    messages.push({ role: "user", content: text });
    const reply = await runTurn(agent, messages, writable);
    await postToThread(payload, reply);
  }

  const writer = writable.getWriter();
  await writer.close();
}

// ---------------------------------------------------------------------------
// Steps — each function below runs as a durable workflow step.
// ---------------------------------------------------------------------------

/** Extract plain-data context and message text without creating Chat SDK objects. */
async function extractContext(payload: string) {
  "use step";
  const parsed = JSON.parse(payload) as {
    message: { text: string };
    context: SerializedAgentContext;
  };
  return { context: parsed.context, messageText: parsed.message.text };
}

/** Run one agent turn, append response to history, return the text. */
async function runTurn(
  agent: DurableAgent,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  writable: WritableStream<UIMessageChunk>,
) {
  const result = await agent.stream({
    messages,
    writable,
    maxSteps: 10,
    preventClose: true,
  });

  const text = result.steps?.at(-1)?.text ?? "";
  if (text) {
    messages.push({ role: "assistant", content: text });
  }
  return text;
}

/** Reconstruct the thread from the raw payload and post a message. */
async function postToThread(payload: string, text: string) {
  "use step";
  if (!text) return;
  const thread = await parseThread(payload);
  await thread.post(text);
}

/** Reconstruct a Chat SDK Message from its serialized form. */
async function deserializeMessage(serialized: any) {
  "use step";
  await initBot();
  return Message.fromJSON(serialized);
}

/** End the session: notify the user, unsubscribe, and clear state. */
async function closeSession(payload: string) {
  "use step";
  const thread = await parseThread(payload);
  await thread.post("Session closed.");
  await thread.unsubscribe();
  await thread.setState({}, { replace: true });
}

/** Reconstruct the Chat SDK thread from the raw payload. */
async function parseThread(payload: string): Promise<Thread<ThreadState>> {
  const bot = await initBot();
  const parsed = JSON.parse(payload, bot.reviver()) as {
    thread: Thread<ThreadState>;
  };
  return parsed.thread;
}

/** Lazy-import and initialize the Chat SDK bot singleton. */
async function initBot() {
  const { bot } = await import("../../lib/bot");
  await bot.initialize();
  return bot;
}
