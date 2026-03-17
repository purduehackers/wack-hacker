import type { UIMessageChunk } from "ai";

import { DurableAgent } from "@workflow/ai/agent";
import { Message, type Thread } from "chat";
import { createHook, getWritable, getWorkflowMetadata } from "workflow";

import type { ThreadState } from "../../lib/bot/types";
import type { ChatTurnPayload } from "./types";

import {
  SYSTEM_PROMPT,
  SYSTEM_PUBLIC_PROMPT,
} from "../../lib/ai/chat/prompts/constants";
import { createChatTools } from "../../lib/ai/chat/tools";
import { AgentContext } from "../../lib/ai/context";
import { DiscordRole } from "../../lib/ai/context/constants";
import type { SerializedAgentContext } from "../../lib/ai/context/types";

/**
 * Multi-turn chat workflow.
 *
 * 1. Parses the serialized payload back into Chat SDK objects
 * 2. Creates a DurableAgent with role-gated tools
 * 3. Runs the first turn and posts the response to Discord
 * 4. Suspends via a hook, awaiting follow-up messages
 * 5. Each subsequent message runs another turn until "done"
 *
 * `getWritable()` feeds workflow observability (`npx workflow web`);
 * Discord delivery happens via `thread.post()` in steps.
 */
export async function chatWorkflow(payload: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const { thread, message, context } = await parsePayload(payload);

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
    { role: "user", content: message.text },
  ];

  const firstReply = await runTurn(agent, messages, writable);
  await postToThread(thread, firstReply);

  using hook = createHook<ChatTurnPayload>({ token: workflowRunId });
  for await (const event of hook) {
    const next = await deserializeMessage(event.message);
    const text = next.text.trim();

    if (text.toLowerCase() === "done") {
      await closeSession(thread);
      break;
    }

    messages.push({ role: "user", content: text });
    const reply = await runTurn(agent, messages, writable);
    await postToThread(thread, reply);
  }

  const writer = writable.getWriter();
  await writer.close();
}

// ---------------------------------------------------------------------------
// Steps — each function below runs as a durable workflow step.
// ---------------------------------------------------------------------------

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

/** Post a text response to the Discord thread. */
async function postToThread(thread: Thread<ThreadState>, text: string) {
  "use step";
  await initBot();
  if (text) {
    await thread.post(text);
  }
}

/** Deserialize the workflow payload. Context is a plain object — use AgentContext.fromJSON to restore. */
async function parsePayload(payload: string) {
  "use step";
  const bot = await initBot();
  return JSON.parse(payload, bot.reviver()) as {
    thread: Thread<ThreadState>;
    message: Message;
    context: SerializedAgentContext;
  };
}

/** Reconstruct a Chat SDK Message from its serialized form. */
async function deserializeMessage(serialized: any) {
  "use step";
  await initBot();
  return Message.fromJSON(serialized);
}

/** End the session: notify the user, unsubscribe, and clear state. */
async function closeSession(thread: Thread<ThreadState>) {
  "use step";
  await initBot();
  await thread.post("Session closed.");
  await thread.unsubscribe();
  await thread.setState({}, { replace: true });
}

/** Lazy-import and initialize the Chat SDK bot singleton. */
async function initBot() {
  const { bot } = await import("../../lib/bot");
  await bot.initialize();
  return bot;
}
