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

The route awaits the discord.js `ClientReady` event before responding, then uses `waitUntil` to keep the remaining lifecycle alive past the HTTP response. The cron's `GET` returns `{ message: "ok" }` only after the bot successfully logs in; if login or readiness fails, the route responds `500`. The hold continues running in the background for the rest of the 10 minutes.

## What the client publishes

`bindMessageHandlers` and `bindGuildHandlers` subscribe to Discord events and translate them into `Packet` values, which are pushed to the `discord-events` queue via `send(DISCORD_EVENT_TOPIC, PacketCodec.encode(packet), { oidcToken })`.

The events bound today:

- `MessageCreate` (filtered to non-bot, text channels)
- `MessageReactionAdd` / `MessageReactionRemove` (filtered to non-bots, message fetched before publish)
- `MessageUpdate` / `MessageDelete`
- `VoiceStateUpdate`
- `ThreadCreate`

The OIDC token is captured at route entry via `getVercelOidcTokenSync()` and passed to the queue client so the publisher is authenticated per request.

## Dev

In dev, you trigger the same code path manually:

```bash
curl http://localhost:3000/api/discord/gateway
```

The listener will run for 10 minutes or until the dev server restarts, whichever comes first.
