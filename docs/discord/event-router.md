# EventRouter

`src/bot/router.ts` defines `EventRouter`, a small fluent dispatcher for the typed Packet stream.

## API

```ts
const router = new EventRouter()
  .onMention(async (packet, ctx) => { ... })
  .onMessage(async (packet, ctx) => { ... })
  .onReactionAdd(async (packet, ctx) => { ... })
  .onReactionRemove(async (packet, ctx) => { ... })
  .onMessageDelete(async (packet, ctx) => { ... })
  .onMessageUpdate(async (packet, ctx) => { ... })
  .onVoiceStateUpdate(async (packet, ctx) => { ... })
  .onThreadCreate(async (packet, ctx) => { ... });

await router.dispatch(packet, ctx);
```

Each `onX` method pushes onto a typed array keyed by packet type. They all return `this` so you can chain them.

`route(raw, ctx)` is a convenience for the queue consumer: it decodes the raw payload with `PacketCodec` first, then calls `dispatch`.

## Dispatch semantics

Inside a single handler array, every handler runs **in parallel** via `Promise.all`. There is no priority and no early-exit within an array.

**Across arrays**, the dispatch order matters for exactly one packet type: `GATEWAY_MESSAGE_CREATE`. For that packet, the router runs all `onMention` handlers first (`await run(this.handlers.mention, packet)`), and only then runs `onMessage` handlers. Every other packet type just dispatches to its single matching array.

The mention check uses `isBotMention(packet.data.content, ctx.botUserId)` from `src/bot/mention.ts`, which matches both `<@botId>` and `<@!botId>` (Discord's nickname mention variant). `stripBotMention` is the helper for removing the prefix before passing the content downstream.

## Wiring

`src/server/routes/handlers.ts` constructs a single exported `router` and seeds it:

1. `router.onMention(handleMention)` — the chat workflow kickoff.
2. `router.onMessage(...)` — a short-circuit on `isBotMention` followed by a lookup-and-resume against any active `ConversationStore` entry. See [Resuming a chat workflow](./chat-resume.md).
3. A loop over every `EventHandler` exported from `@/bot/handlers/events`, switched on `h.type`, binding each to the appropriate `on*` method.

The resulting `router` is imported by `src/server/process-event.ts`, which is the only place `dispatch` is actually called in production.
