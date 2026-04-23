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
5. Maintains a small render state: `{ text, activity, subagentPreview }`.
6. Handles each stream event:
   - **`text-delta`** — append `event.text` to `state.text`, clear `activity` and `subagentPreview`.
   - **`tool-input-start`** — set `activity` to `` `Calling \`${event.toolName}\`...` ``, clear the subagent preview.
   - **`tool-result`** (preliminary, from a subagent) — extract a short text via `previewSubagentText(output as UIMessage)` and update `state.subagentPreview`.
   - **`tool-result`** (final) — clear `activity` and `subagentPreview`.
7. After each event, `flush(force = false)` runs: if at least `EDIT_INTERVAL_MS` has passed since the last edit AND the newly-`render(state)`ed content differs from the last rendered content, it calls `discord.channels.editMessage` with the new body.
8. When the stream ends, it does a final edit with `truncate(state.text || "I didn't have anything to say.")`. If the edit fails (e.g. Discord 404 on a deleted message), it falls back to sending a new message.
9. Returns `{ text }`.

## The render function

```ts
function render(state: { text; activity; subagentPreview }): string {
  const parts = [];
  if (state.activity) parts.push(`-# ${state.activity}`);
  if (state.subagentPreview) parts.push(`> ${preview.replaceAll("\n", "\n> ")}`);
  if (state.text) parts.push(state.text);
  return truncate(parts.join("\n\n") || "> Thinking...");
}
```

The activity line uses Discord's `-# ` subtle text syntax. The subagent preview uses blockquotes. The main text is whatever the orchestrator has emitted so far.

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
