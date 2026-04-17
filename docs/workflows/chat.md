# chatWorkflow

`src/workflows/chat.ts`. Multi-turn conversations between a user and the orchestrator, durable across messages and redeploys.

## Payload

```ts
type ChatPayload = {
  channelId: string;
  content: string;
  context: SerializedAgentContext;
};
```

## State

The workflow owns three pieces of state over its lifetime (see [Agents § AgentContext](../agents/context.md) for the full model):

- **Stable context** — `channel`, `thread`, `recentMessages` from the initial payload. Pinned at start; never re-fetched or mutated.
- **Per-turn context** — `userId`/`username`/`memberRoles`/`attachments`/`date` sourced fresh from each hook event's packet. This is why a follow-up from a different user is evaluated with their own roles, not the original mention author's.
- **`messages: ChatMessage[]`** — a local array of `{role, content}` pairs that grows by two entries per turn (user input, assistant output). Passed directly to `agent.stream({ messages })` so the model sees real conversation turns, not scraped channel history.

## Flow

What the workflow does, top to bottom:

1. Declares `"use workflow"` and reads its own `workflowRunId` from `getWorkflowMetadata()`.
2. Captures `stableChannel`, `stableThread`, `stableRecentMessages` from the payload's initial context.
3. Initializes `messages = [{ role: "user", content }]` and calls `runTurn(channelId, messages, context)`. Appends the assistant's reply to `messages`. `runTurn` is marked `"use step"` and delegates to `streamTurn` (see [Agents § streaming](../agents/streaming.md)).
4. Opens a hook via `createHook<ChatHookEvent>({ token: workflowRunId })`. The hook accepts events of shape:

   ```ts
   type ChatHookEvent =
     | { type: "message"; content: string; context: SerializedAgentContext }
     | { type: "done" };
   ```

5. Enters `for await (const event of hook)`, which **suspends** the workflow until something calls `resumeHook(workflowRunId, event)` from the outside.
6. Each resumed message merges the event's fresh per-turn context with the stable fields (`{ ...event.context, channel: stableChannel, thread: stableThread, recentMessages: stableRecentMessages }`), pushes the user message onto `messages`, calls `runTurn`, and pushes the assistant response. A `"done"` event (or hook expiration) ends the loop.
7. On exit, calls `cleanupConversation(channelId)` to delete the conversation state from Redis.

The `using hook = createHook(...)` syntax takes advantage of JavaScript's explicit resource management proposal — the hook is automatically disposed when the loop exits.

## Durability of the messages array

`messages` is a plain local variable, not a step result, so it might look like it would be lost on crash. Vercel WDK handles this: `runTurn` is a `"use step"` and its return value is memoized. On replay, `runTurn` returns the cached result without re-executing, and the `messages.push(...)` calls that followed each step replay deterministically — rebuilding `messages` to the same contents it had before the crash.

## Hooks

`resumeHook` is called from two places:

- **The mention handler** (`src/bot/handlers/events/mention/index.ts`) — looks up the conversation; if one exists, builds a fresh `AgentContext.fromPacket(packet)` (no `recentMessages` — that's stable) and calls `resumeHook(workflowRunId, { type: "message", content, context })`. If not, it creates a thread (when not already in one), fetches `recentMessages` for the initial context, and calls `start(chatWorkflow, [payload])`, then stores the new `workflowRunId` in `ConversationStore` so follow-ups can find it.
- **The non-mention message handler** (`src/server/routes/handlers.ts`) — only resumes, never starts. Same per-turn context build, same event shape. Short-circuits early on `isBotMention` so the mention handler doesn't get double-routed.

Follow-up events carry the fresh per-turn context (sender identity, roles, attachments, date). The workflow merges in the stable channel/thread/recentMessages it captured at start, so those never flip across turns.

In either case, if `resumeHook` throws (workflow expired, hook unavailable, etc.), the handler deletes the stale state.

See [Discord § resuming a chat workflow](../discord/chat-resume.md) for the handler-side details.

## State lifetime

The `ConversationStore` Redis key has a 1-hour TTL (set in `src/bot/store.ts`), refreshed via `touch()` whenever a follow-up message is forwarded. The chat workflow's hook stays valid for as long as the workflow run survives — once it expires, `resumeHook` throws and the handler deletes the stale Redis key on the next attempt.

## Why `runTurn` is its own step

Workflows checkpoint at step boundaries. Making `runTurn` a `"use step"` means the turn's output (the final agent text) is persisted, so if the function crashes after `streamTurn` returns but before `createHook` opens, the workflow can resume without re-running the turn. Without the step boundary, every crash would replay the whole `streamTurn` call — doubling Discord messages and token spend.

`cleanupConversation` is also its own step for the same reason: the cleanup should only run once, even across retries.
