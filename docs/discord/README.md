# Discord layer

This is the front of the bot — everything that turns a Discord event into a function call inside the codebase. If you're adding a new bot behavior (a slash command, a reaction handler, an auto-response), this is the right starting point.

## Two ingress paths

Discord can deliver events to the bot two ways:

1. **Gateway WebSocket** — a long-lived discord.js client connected to the Discord gateway. Every event the client receives is encoded as a `Packet` and pushed onto the `discord-events` Vercel Queue.
2. **HTTP interactions** — Discord POSTs slash commands and component callbacks to `/api/discord/interactions`. These are signature-verified and replied to inline; they never touch the queue.

Each path goes through its own router and reaches a different slice of `src/bot/handlers/`:

```
gateway WS  ──▶  discord-events queue  ──▶  /api/discord/events  ──▶  EventRouter  ──▶  handlers/events
HTTP        ──▶  /api/discord/interactions                                         ──▶  handlers/commands & components
```

Crons are a third path entirely: `vercel.ts` schedules `GET /api/crons/:name`, which dispatches to `handlers/crons` directly.

## Contents

| Doc | Topic |
| --- | ----- |
| [Gateway leader election](./gateway.md) | The `/api/discord/gateway` route, Redis-based leader election, the cron that keeps it alive. |
| [EventRouter](./event-router.md) | The fluent dispatcher that fans packets out to handlers, including the mention-vs-message ordering. |
| [Inbound consumer](./inbound.md) | Queue consumer, dedup, per-channel locking, retry policy, and the `ConversationStore` API. |
| [Resuming a chat workflow](./chat-resume.md) | How both mention and message handlers feed messages back into a running `chatWorkflow`. |
| [Writing handlers](./handlers.md) | `defineCommand`, `defineComponent`, `defineEvent`, `defineCron` — how to wire up each handler type. |
| [Protocol](./protocol.md) | Packet schema, codec, and interaction signature verification. |

## Common gotchas

- **Bot messages are filtered at the gateway** (`if (message.author.bot) return`). Handlers will never see them.
- **At-least-once delivery**: the consumer dedupes packets globally before dispatch, but if your handler does its own work that should be idempotent across retries (e.g. writing to an external service), don't rely solely on the global dedup — Vercel will retry up to 3 times.
- **Within a single packet type, handlers run in parallel** — don't write handlers that depend on each other's side effects. The one exception is `MESSAGE_CREATE`, where mention handlers complete before message handlers begin.
- **Mentions are double-routed**: a mention also satisfies `onMessage`. The mention handler resumes/starts a workflow; the message handler short-circuits when it detects the mention prefix to avoid double-running.
- **Per-channel locking is `MESSAGE_CREATE` only.** Reactions, deletions, voice-state updates, and thread-create packets dispatch without a lock.
