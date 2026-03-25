import { ToolLoopAgent, stepCountIs, type TextStreamPart, type ToolSet } from "ai";

import { Message, type Thread, type StreamEvent } from "chat";
import { createHook, getWorkflowMetadata } from "workflow";

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
  const instructions = AgentContext.fromJSON(context).buildInstructions(rawPrompt);

  const agent = new ToolLoopAgent({
    model: "anthropic/claude-sonnet-4",
    instructions,
    tools: createChatTools(context),
    stopWhen: stepCountIs(10),
  });

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: messageText },
  ];

  await streamTurn(agent, messages, payload);

  using hook = createHook<ChatTurnPayload>({ token: workflowRunId });
  for await (const event of hook) {
    const next = await deserializeMessage(event.message);
    const text = next.text.trim();

    if (text.toLowerCase() === "done") {
      await closeSession(payload);
      break;
    }

    messages.push({ role: "user", content: text });
    await streamTurn(agent, messages, payload);
  }
}

// ---------------------------------------------------------------------------
// Helpers
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

/** Run one agent turn, streaming the response to Discord in real-time. */
async function streamTurn(
  agent: ToolLoopAgent,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  payload: string,
) {
  const thread = await parseThread(payload);

  const result = await agent.stream({ messages });
  await thread.post(
    withToolProgress(result.fullStream) as AsyncIterable<string | StreamEvent>,
  );

  const text = await result.text;
  if (text) messages.push({ role: "assistant", content: text });
  return text;
}

/**
 * Stream transform that injects preliminary tool results as displayable text.
 *
 * Chat SDK's fromFullStream only renders text-delta and plain strings —
 * tool-result events are silently skipped. This transform intercepts
 * preliminary tool results (from async generator tools) and re-emits
 * their string content so it appears in the Discord message.
 */
async function* withToolProgress(
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>,
): AsyncIterable<TextStreamPart<ToolSet> | string> {
  for await (const event of fullStream) {
    yield event;

    if (
      event.type === "tool-result" &&
      event.preliminary === true &&
      typeof event.output === "string"
    ) {
      yield event.output;
    }
  }
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
