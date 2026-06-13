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
2. Captures the stable scope (`channel`, `thread`, `recentMessages`, `referencedContext`) from the payload's initial context.
3. Runs the first turn via `runTurn` (a `"use step"` that delegates to `streamTurn` — see [Agents § streaming](../agents/streaming.md)) and appends the assistant's reply to `messages`.
4. Opens a hook via `createHook<ChatHookEvent>({ token: workflowRunId })`. The hook accepts events of shape:

   ```ts
   type ChatHookEvent =
     | { type: "message"; content: string; context: SerializedAgentContext }
     | { type: "done" };
   ```

5. Enters the hook loop (`runHookLoop`), which races the hook's async iterator against a durable idle timer each iteration — the Workflow DevKit's documented timeout pattern:

   ```ts
   const winner = await Promise.race([hookEvents.next(), sleep(IDLE_TIMEOUT).then(() => IDLE)]);
   ```

   The workflow **suspends** until something calls `resumeHook(workflowRunId, event)` or the timer fires. Each resumed message merges the event's fresh per-turn context with the stable fields, pushes the user message onto `messages`, calls `runTurn`, and pushes the assistant response. The loop ends on a `"done"` event (`ended_by: "user"`), the idle timer (`ended_by: "idle_timeout"`), or the hook closing (`ended_by: "hook_close"`).

6. On exit — including the error path, via `try/finally` — calls `cleanupConversation`, drains straggler events (see below), and emits the conversation's terminal wide event (`ended_by`, `turn_count`, `total_tokens`).

The `using hook = createHook(...)` syntax takes advantage of JavaScript's explicit resource management proposal — the hook is automatically disposed when the workflow body exits.

## Idle timeout and cleanup ownership

`IDLE_TIMEOUT` is **55 minutes**, deliberately below the 1-hour `ConversationStore` TTL. The key's TTL refreshes when a follow-up _arrives_ (the handler `touch()`es it before the turn runs) but the idle timer is armed only after the turn _finishes_ — with a 1h timer the key would always be expired by the time cleanup ran. The 5-minute margin covers turn duration.

`cleanupConversation` **compare-and-deletes**: it reads the stored `ConversationState` first and only deletes the conversation key, the context snapshot, and the sandbox session when the stored `workflowRunId` matches its own run. This guards the race where a stale run's cleanup would otherwise tear down a successor workflow's conversation and stop its live sandbox.

## Straggler drain

After cleanup, the workflow listens for `DRAIN_GRACE` (10s) more: a `resumeHook` that was in flight while the loop stopped consuming events lands in the hook buffer, and its sender saw success — so the handlers will never start a fresh workflow for that message. The drain answers those buffered messages as normal turns instead of silently dropping them. New resumes can't occur during the drain because the conversation key is already deleted.

## Turn failures

`streamTurn` classifies any failure after the stream has started (tools may have run) as a WDK `FatalError`, after posting a user-visible failure message. `runTurn` converts that into an `{ error: true }` sentinel: the failed turn's user message is popped from history and the workflow **keeps listening** for follow-ups instead of dying. Errors before the stream starts (e.g. the renderer's placeholder post failing) stay plain and get WDK's default step retries; if those exhaust, `notifyTurnFailure` posts a last-resort failure message. This split exists because replaying a side-effectful turn re-runs subagent delegations and external writes — see the plan's "Do NOT" list and `docs/agents/streaming.md` for the streaming-side classification.

## History management

- **Cap with summarization** — history is capped at 50 messages (25 exchanges). When the cap trips, the dropped prefix is replaced by a single summary message produced by a cheap model (`gpt-5.4-mini`) inside a `"use step"` (`summarizeHistory`, `maxRetries = 1`). If the summary step fails, the prefix is dropped wholesale (the old behavior).
- **Assistant truncation** — stored assistant turns are clipped to 4,000 chars with a `\n[truncated]` marker. The full text was already delivered to Discord; history only needs continuity.

## Debug snapshots

After each successful turn, `runTurn` persists a `StoredContextSnapshot` (`context`, `messages`, `totalUsage`, `turnCount`, `updatedAt`) for the `/Inspect Context` command — only the cheap dynamic slice. The expensive derived view (system prompt, materialized tool schemas) is rebuilt on demand at read time via `buildContextSnapshot` (`src/lib/ai/snapshot.ts`). The write is best-effort: a Redis blip must not fail the turn.

## Durability of the messages array

`messages` is a plain local variable, not a step result, so it might look like it would be lost on crash. Vercel WDK handles this: `runTurn` is a `"use step"` and its return value is memoized. On replay, `runTurn` returns the cached result without re-executing, and the `messages.push(...)` calls that followed each step replay deterministically — rebuilding `messages` to the same contents it had before the crash.

## Hooks

`resumeHook` is called from three places:

- **The mention handler** (`src/bot/handlers/events/mention/index.ts`) — looks up the conversation; if one exists, builds a fresh `AgentContext.fromPacket(packet)` (no `recentMessages` — that's stable) and calls `resumeHook(workflowRunId, { type: "message", content, context })`. If not, it creates a thread (when not already in one), fetches `recentMessages` for the initial context, and calls `start(chatWorkflow, [payload])`, then stores the new `workflowRunId` in `ConversationStore` so follow-ups can find it.
- **The non-mention message handler** (`src/server/routes/handlers.ts`) — only resumes, never starts. Same per-turn context build, same event shape. Short-circuits early on `isBotMention` so the mention handler doesn't get double-routed.
- **The ✅ reaction handler** (`src/bot/handlers/events/conversation-done/index.ts`) — sends `{ type: "done" }` when someone reacts ✅ to one of the bot's replies in an active conversation, ending it gracefully instead of waiting out the idle timer.

Follow-up events carry the fresh per-turn context (sender identity, roles, attachments, date). The workflow merges in the stable channel/thread/recentMessages it captured at start, so those never flip across turns.

In either case, if `resumeHook` throws (workflow expired, hook unavailable, etc.), the handler deletes the stale state.

See [Discord § resuming a chat workflow](../discord/chat-resume.md) for the handler-side details.

## State lifetime

The `ConversationStore` Redis key has a 1-hour TTL (set in `src/bot/store.ts`), refreshed via `touch()` whenever a follow-up message is forwarded. The workflow itself ends at the 55-minute idle timeout (or earlier on `"done"`), running cleanup and emitting its terminal wide event — hook expiry is no longer the normal end of a conversation.

## Why `runTurn` is its own step

Workflows checkpoint at step boundaries. Making `runTurn` a `"use step"` means the turn's output (the final agent text) is persisted, so if the function crashes after `streamTurn` returns but before `createHook` opens, the workflow can resume without re-running the turn. Without the step boundary, every crash would replay the whole `streamTurn` call — doubling Discord messages and token spend.

`cleanupConversation` is also its own step for the same reason: the cleanup should only run once, even across retries.
