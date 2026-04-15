# Resuming a chat workflow

Both the mention handler and the message handler can resume an existing `chatWorkflow`:

## Mention path

`src/bot/handlers/events/mention/index.ts` (`handleMention`):

1. Strips the bot mention from the content. If nothing's left, replies with a canned "Hey! What can I help you with?" and exits.
2. Looks up the active `ConversationState` via `ctx.store.get(channelId, threadId?)`.
3. **If found**: calls `resumeHook(existing.workflowRunId, { type: "message", content, authorId, authorUsername })`, touches the Redis key to refresh the TTL, and returns.
4. **If `resumeHook` throws** (workflow expired / gone): deletes the stale state and continues to step 5.
5. **If not in a thread already**: creates a thread on the source message (`auto_archive_duration: 60`), naming it `${nickname ?? username} — ${content.slice(0, 54)}`. The new thread ID becomes both `conversationChannelId` and `conversationThreadId`.
6. Builds an `AgentContext` from the packet via `AgentContext.fromPacket(packet)`.
7. Calls `start(chatWorkflow, [{ channelId, content, context: agentContext.toJSON() }])` to begin a new workflow.
8. Stores the new conversation state (`{ workflowRunId, channelId, threadId, startedAt }`) so follow-up messages can find it.

## Non-mention message path

`src/server/routes/handlers.ts` (the anonymous `onMessage` handler registered from this file):

1. **Short-circuits early on `isBotMention`** so the mention handler doesn't get double-routed.
2. Looks up the active `ConversationState`. If none, returns.
3. Calls `resumeHook(existing.workflowRunId, event)`. Touches the key on success.
4. If `resumeHook` throws (workflow expired, etc.), deletes the stale state.

This path **only resumes** — it never starts a new workflow. Starts are always triggered by a mention.

## Why mentions are "double-routed"

Because a mention message also satisfies `onMessage`, both mention and message handlers would normally fire for the same packet. The `EventRouter` runs `onMention` handlers first (see [EventRouter](./event-router.md)), but the mention handler calls `resumeHook` with the **stripped** content; if the message handler then ran as well, it would forward the **un-stripped** content into the conversation and cause a duplicate turn.

The early `isBotMention` check in the message handler is what prevents this. The tradeoff is that two handlers both know about mention syntax — mention once, short-circuit once — but it keeps the stripping logic in exactly one place (the mention handler).
