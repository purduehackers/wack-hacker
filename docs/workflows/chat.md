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

## Flow

What the workflow does, top to bottom:

1. Declares `"use workflow"` and reads its own `workflowRunId` from `getWorkflowMetadata()`.
2. Calls `runTurn(channelId, content, context)` for the initial turn. `runTurn` is marked `"use step"` and just delegates to `streamTurn` (see [Agents § streaming](../agents/streaming.md)).
3. Opens a hook via `createHook<ChatHookEvent>({ token: workflowRunId })`. The hook accepts events of shape:

    ```ts
    interface ChatHookEvent {
      type: "message" | "done";
      content: string;
      authorId: string;
      authorUsername: string;
    }
    ```

4. Enters `for await (const event of hook)`, which **suspends** the workflow until something calls `resumeHook(workflowRunId, event)` from the outside.
5. Each resumed message triggers another `runTurn`. A `"done"` event (or hook expiration) ends the loop.
6. On exit, calls `cleanupConversation(channelId)` to delete the conversation state from Redis.

The `using hook = createHook(...)` syntax takes advantage of JavaScript's explicit resource management proposal — the hook is automatically disposed when the loop exits.

## Hooks

`resumeHook` is called from two places:

- **The mention handler** (`src/bot/handlers/events/mention/index.ts`) — looks up the conversation; if one exists, calls `resumeHook(workflowRunId, event)`. If not, it creates a thread (when not already in one) and calls `start(chatWorkflow, [payload])`, then stores the new `workflowRunId` in `ConversationStore` so follow-ups can find it.
- **The non-mention message handler** (`src/server/routes/handlers.ts`) — only resumes, never starts. Looks up the conversation and calls `resumeHook` if one exists; ignores the message otherwise. Short-circuits early on `isBotMention` so the mention handler doesn't get double-routed.

In either case, if `resumeHook` throws (workflow expired, hook unavailable, etc.), the handler deletes the stale state.

See [Discord § resuming a chat workflow](../discord/chat-resume.md) for the handler-side details.

## State lifetime

The `ConversationStore` Redis key has a 1-hour TTL (set in `src/bot/store.ts`), refreshed via `touch()` whenever a follow-up message is forwarded. The chat workflow's hook stays valid for as long as the workflow run survives — once it expires, `resumeHook` throws and the handler deletes the stale Redis key on the next attempt.

## Why `runTurn` is its own step

Workflows checkpoint at step boundaries. Making `runTurn` a `"use step"` means the turn's output (the final agent text) is persisted, so if the function crashes after `streamTurn` returns but before `createHook` opens, the workflow can resume without re-running the turn. Without the step boundary, every crash would replay the whole `streamTurn` call — doubling Discord messages and token spend.

`cleanupConversation` is also its own step for the same reason: the cleanup should only run once, even across retries.
