# Streaming

`src/lib/ai/streaming.ts` exports `streamTurn(discord, channelId, messages, serializedContext, taskId?)`. This is the function `chatWorkflow` and the `scheduled-task-fire` queue handler actually call — it owns the entire loop from "bot was mentioned" to "Discord message is updated".

`messages` is the full `ChatMessage[]` conversation history so far; the **last entry is the current user input** and prior entries are passed to the model as assistant/user turns. For single-turn callers (scheduled tasks), wrap the prompt as `[{ role: "user", content: prompt }]`.

## Constants

```ts
const EDIT_INTERVAL_MS = 1500;
const MAX_LENGTH = 1900; // Discord's hard cap is 2000
```

The 1.5-second debounce keeps Discord rate-limits happy while still feeling live. The 1900 cap leaves headroom for the `…` truncation suffix.

## What it does, top to bottom

1. Rehydrates `AgentContext` from JSON via `AgentContext.fromJSON(serializedContext)`.
2. Calls `createOrchestrator(agentCtx)`.
3. Sends an initial Discord message: `> Thinking...`. Holds onto its message ID.
4. Splits `messages` into prior turns and the current user input, then calls `agent.stream({ messages: [...priorTurns, currentUserMessage] })`. The current user message goes through `buildUserMessage(content, agentCtx.attachments)`, which inlines image/file attachments as multimodal content parts so the model can see them directly. Consumes the `fullStream`.
5. Maintains render state in `MessageRenderer`: `{ text, activity, subagentPreviews }` — previews are a `Map` keyed by `toolCallId`, because the orchestrator runs parallel delegations under `Promise.all` and concurrent previews must not clobber each other.
6. Handles each stream event:
   - **`text-delta`** — append `event.text` to the text, clear `activity` and all previews.
   - **`tool-input-start`** — set `activity` to `` `Calling \`${event.toolName}\`...` `` (existing previews stay — a sibling delegation may still be streaming).
   - **`tool-result`** (preliminary, from a subagent) — extract a short text via `previewSubagentText(output as UIMessage)` and update that `toolCallId`'s preview.
   - **`tool-result`** (final) — clear `activity` and that call's preview.
   - **`tool-error`** — clear that call's activity/preview and show a transient `` `toolName` failed. `` status line.
   - **`error`** (terminal) — recorded and surfaced as a turn failure after the stream ends (the AI SDK emits an error part instead of throwing, so without this the turn would finish looking normal with no text).
7. After each event, `flush()` runs: if at least `EDIT_INTERVAL_MS` has passed since the last edit AND the newly-rendered content differs from the last rendered content, it calls `discord.channels.editMessage` with the new body.
8. When the stream ends, it does a final edit with the accumulated text (or `"I didn't have anything to say."`). If the edit fails (e.g. Discord 404 on a deleted message), it falls back to sending a new message.
9. Returns `{ text, usage, discordMessageId, model }` — `model` is the slug that actually ran, which matters after a fallback.

## Model fallback

The stream runs through `streamWithFallback`: on a terminal provider error it retries once per entry in `ORCHESTRATOR_FALLBACK_MODELS` (currently `claude-haiku-4.5`) — **but only while no tool has run**. Tool executions are external side effects (GitHub/Linear/Discord writes); replaying the turn after one would duplicate them. On retry the renderer is `reset()` so the fallback streams from scratch.

## Failure classification

Any failure once the stream is live — a terminal `error` part, a stream exception after the fallback is exhausted, or a `finalizeTurn` failure (which runs after tools executed) — goes through `failTurn`: the user sees `Something went wrong — try again. Trace: \`<id>\``, the `ai.turn`wide event emits`outcome: "error"`, and a WDK `FatalError` is thrown so the workflow step never replays the side-effectful turn (`runTurn` converts it to a sentinel and keeps listening). Errors _before_ the stream starts (e.g. the placeholder post failing) stay plain and get WDK's default step retries. See [Workflows § chat](../workflows/chat.md#turn-failures).

## The render function

```ts
function render(): string {
  const parts = [];
  if (activity) parts.push(`-# ${activity}`);
  for (const preview of subagentPreviews.values())
    parts.push(`> ${preview.replaceAll("\n", "\n> ")}`);
  if (text) parts.push(text);
  return truncate(parts.join("\n\n") || "> Thinking...");
}
```

The activity line uses Discord's `-# ` subtle text syntax. Each in-flight subagent preview renders as its own blockquote. The main text is whatever the orchestrator has emitted so far.

Activity lines and subagent previews are deliberately ephemeral — they appear only while a tool is running and disappear when the next text delta arrives.

## buildUserMessage

```ts
buildUserMessage(content: string, attachments?: Attachment[])
```

Returns a single `{ role: "user", content }` `CoreMessage` suitable for use as the last slot of an AI SDK `messages` array. If there are no attachments, `content` is a plain string. Otherwise `content` is an array of parts: one `text` part for the message text, then one part per attachment (`image` for `image/*` content types, `file` otherwise).

Attachments are only applied to the current turn's user message — not to prior-turn history — since attachments were already processed when that prior turn ran.

## Where streamTurn gets called

- **`chatWorkflow` → `runTurn` → `streamTurn`** — for every user turn. `runTurn` is marked `"use step"` so the workflow checkpoints its output.
- **`scheduled-task-fire` handler → `executeAction` → `streamTurn`** — for scheduled tasks with `action.type === "agent"`. A synthetic `AgentContext` is built with `username: "system"` and `nickname: "Scheduled Task"`, with a fresh `nowISO` captured at fire time.

You should not call `streamTurn` from anywhere else.
