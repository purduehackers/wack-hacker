# Gateway leader election

`src/server/routes/gateway.ts` runs a discord.js client. Because Vercel can spin up multiple instances of the same function and we only want **one** active gateway listener at any time, the route does its own leader election via Redis.

## Lease lifecycle

- Acquires a 15-second lease on `gateway:leader` with a unique listener ID (`gw_${ulid()}`).
- If another listener already holds the lease when this one starts, waits up to 8 seconds for handoff.
- A 5-second poll renews the lease while the listener is alive. If the poll reads back a different ID, the current listener aborts gracefully.
- Holds the connection for 10 minutes, then tears down the discord.js client and releases the lease (only if the lease still belongs to this listener).

The relevant constants live at the top of `gateway.ts`:

```ts
const HOLD_MS = 10 * 60 * 1000;
const LEASE_TTL_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const HANDOFF_WAIT_MS = 8_000;
```

## Cron

`vercel.ts` schedules `*/9 * * * *` → `GET /api/discord/gateway`. The 9-minute cadence deliberately overlaps with the 10-minute hold so there's always a listener trying to claim the lease. If an instance dies mid-hold, the next cron invocation picks up within a minute.

The route requires `Authorization: Bearer ${CRON_SECRET}` (Vercel crons attach it automatically), same as `/api/crons/:name`. Without it, any caller could trigger the unconditional lease steal and black out the gateway for the login handoff. The lease acquisition itself is deliberately **not** `NX` — the unconditional steal is what lets the 9-minute cron take over a 10-minute hold whose lease never expires (it renews every 5 seconds).

The route awaits the discord.js `ClientReady` event before responding, then uses `waitUntil` to keep the remaining lifecycle alive past the HTTP response. The cron's `GET` returns `{ message: "ok" }` only after the bot successfully logs in; if login or readiness fails, the route responds `500`. The hold continues running in the background for the rest of the 10 minutes.

## What the client publishes

`bindGatewayEvents(client, publish)` (from `src/lib/protocol/events/`) iterates the protocol event table and attaches each event's discord.js listener. Listeners translate Discord events into `Packet` values, which are pushed to the `discord-events` queue via `send(DISCORD_EVENT_TOPIC, PacketCodec.encode(packet), { oidcToken })`. The serialization for each event lives in its protocol module, next to its schema and dedup key — the gateway route contains no per-event code. Each listener body is wrapped in `guardEvent` so one bad event is logged and counted rather than becoming an unhandled rejection.

The events bound today:

- `MessageCreate` (filtered to non-bot, text channels)
- `MessageReactionAdd` / `MessageReactionRemove` (filtered to non-bots, published straight off the partial — no REST fetch, so reactions on just-deleted messages still relay)
- `MessageDelete`

The client intents follow the table: `Guilds`, `GuildMessages`, `MessageContent`, `GuildMessageReactions`. (`GuildVoiceStates` was removed along with the unused `VOICE_STATE_UPDATE` packet — re-add the intent in the gateway route if a voice event ever returns.)

Every listener body runs through a `guard()` wrapper — discord.js doesn't await listeners, so without it a rejection is unhandled and the event silently lost. Guard failures are logged and counted as `gateway.handler_error`.

The OIDC token is captured at route entry via `getVercelOidcTokenSync()` and passed to the queue client so the publisher is authenticated per request.

## Dev

In dev, you trigger the same code path manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/discord/gateway
```

The listener will run for 10 minutes or until the dev server restarts, whichever comes first.
