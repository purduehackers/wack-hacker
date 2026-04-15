# Inbound consumer

The queue consumer is split across two files.

## `src/app/api/discord/events/route.ts`

The Next.js route file Vercel attaches the `discord-events` queue trigger to. It:

1. Uses `handleCallback<string>` from `@/lib/tasks/queue/client` to wrap the POST handler with queue-aware retry logic.
2. Decodes the payload via `PacketCodec.decode(encoded)`.
3. Logs the packet type and the delivery attempt count.
4. Constructs a fresh `ConversationStore` and forwards to `processEvent(packet, store)`.

Retries up to **3 times** with exponential backoff (`Math.min(300, 2 ** deliveryCount * 5)` seconds between attempts). After the third failure, it returns `{ acknowledge: true }` to drop the message.

## `src/server/process-event.ts`

The actual dispatch logic. For each packet it:

1. **Dedupes** using `ConversationStore.dedup(key)` — atomic `SET NX` against Redis, 5-minute window by default. Dedup keys are packet-type-specific (see below). If the key already exists, the packet is dropped silently (`log.debug "Dedup hit"`).
2. **Locks per channel** for `MESSAGE_CREATE` only via `ConversationStore.acquireLock(channelId)` — 30-second TTL, token-matched release (Lua script). Other packet types skip locking.
3. **If the lock can't be acquired**, the packet is **dropped** with a warning log — it does not wait. Vercel Queues will retry the delivery later, by which point the lock has likely expired.
4. **Dispatches** to `router.dispatch(packet, ctx)` with a freshly-constructed `ctx` containing a Discord API client (`new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN))`), the `ConversationStore`, and `env.DISCORD_CLIENT_ID` as the bot user ID.
5. **Releases** the lock in a `finally`.

### Dedup keys

```
GATEWAY_MESSAGE_CREATE          → msg:${id}
GATEWAY_MESSAGE_REACTION_ADD    → react:${messageId}:${userId}:${emojiId ?? emojiName}
GATEWAY_MESSAGE_REACTION_REMOVE → unreact:${messageId}:${userId}:${emojiId ?? emojiName}
GATEWAY_MESSAGE_DELETE          → del:${id}
GATEWAY_MESSAGE_UPDATE          → upd:${id}:${timestamp}
GATEWAY_VOICE_STATE_UPDATE      → voice:${userId}:${channelId ?? "left"}:${timestamp}
GATEWAY_THREAD_CREATE           → thread:${id}
```

Message updates and voice state updates include the timestamp so a burst of changes on the same entity doesn't get collapsed.

## ConversationStore

`ConversationStore` (in `src/bot/store.ts`) wraps Redis with three concerns:

| Method                                                | Purpose                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `get/set/delete/touch(channelId, threadId?)`          | Conversation state, keyed by `conversation:${threadId ?? channelId}`, 1h TTL.                      |
| `dedup(key, ttlMs?)`                                  | Atomic `SET NX PX`. Returns `true` if the key was freshly written. Default TTL 5 min.              |
| `acquireLock(key, ttlMs?) → token \| null`            | Generates a UUID, atomic `SET NX PX`. Returns the token on success, `null` if held. Default TTL 30s. |
| `releaseLock(key, token)`                             | Lua script: only deletes if the stored token matches.                                              |

The state-key rule (thread first, channel second) ensures parallel threads under the same parent channel don't collide. The caller never picks the lock token — `acquireLock` generates it internally and gives it back.
