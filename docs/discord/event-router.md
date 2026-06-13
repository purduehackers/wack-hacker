# EventRouter

`src/bot/router.ts` defines `EventRouter`, a small fluent dispatcher for the typed Packet stream.

## API

```ts
const router = new EventRouter()
  .on("mention", async (packet, ctx) => { ... })
  .on("message", async (packet, ctx) => { ... })
  .on("reactionAdd", async (packet, ctx) => { ... })
  .on("reactionRemove", async (packet, ctx) => { ... })
  .on("messageDelete", async (packet, ctx) => { ... });

router.register(someDefineEventHandler); // a defineEvent({ type, handle }) object

await router.dispatch(packet, ctx);
```

`on(kind, handler)` is generic over the handler kind: the packet parameter is typed per kind via the protocol event table (`PacketForKind`), so there's one registration method instead of one `onX` per packet type. Kinds come from the table (`src/lib/protocol/events/`), plus `"mention"` — a derived kind for `GATEWAY_MESSAGE_CREATE` packets that lead with an @-mention of the bot or reply to it in a thread. `register(handler)` is the convenience for `defineEvent` objects; both return `this` for chaining.

## Dispatch semantics

Inside a single handler list, every handler runs **in parallel** via `Promise.all`. There is no priority and no early-exit within a list.

**Across kinds**, the dispatch order matters for exactly one packet type: `GATEWAY_MESSAGE_CREATE`. For that packet, the router runs all `"mention"` handlers first, and only then runs `"message"` handlers. Every other packet type dispatches to the single kind the event table maps it to (`kindOfPacketType`).

The mention check uses `isBotMention(packet.data, ctx.botUserId)` and `isReplyToBot` from `src/bot/mention.ts` — `isBotMention` matches both `<@botId>` and `<@!botId>` (Discord's nickname mention variant); `stripBotMention` removes the prefix before passing content downstream. The router computes `isBotMention` **once per packet** and hands it to message-create handlers as `ctx.isBotMention`, so handlers read the flag instead of re-deriving it.

## Wiring

`src/server/routes/handlers.ts` constructs a single exported `router` and seeds it:

1. `router.on("mention", handleMention)` — the chat workflow kickoff.
2. `router.on("message", ...)` — a short-circuit on `ctx.isBotMention` followed by a lookup-and-resume against any active `ConversationStore` entry. See [Resuming a chat workflow](./chat-resume.md).
3. A loop over every `EventHandler` exported from `@/bot/handlers/events`, passing each to `router.register(h)`.

The resulting `router` is imported by `src/server/process-event.ts`, which is the only place `dispatch` is actually called in production.
