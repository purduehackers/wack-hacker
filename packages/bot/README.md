# `@repo/bot`

The Discord-facing process. A long-lived Bun program holding one `discord.js` gateway connection, an HTTP server for agent callbacks, and the single writer for the agent's visible replies.

It owns Discord I/O and nothing else. It has no model, no provider credentials beyond Discord, and no opinion about what the agent decides — it turns gateway events into queued turns, and stored desired state into Discord effects.

## Two surfaces

The process runs two things that share a Discord client and telemetry but not authorization or state:

| Surface          | What it is                                                                       | Where                                |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| **Conversation** | Addressed messages become agent turns; the agent's replies get painted back      | `agent/`, `utils/conversation/`      |
| **Community**    | Slash commands, gateway automations, and local cron that never involve the agent | `commands/`, `events/`, `schedules/` |

## Layout

```
src/
  index.ts          composition root — the only place dependencies are wired
  instrument.ts     --preload: Sentry, before anything else loads
  env.ts            validated environment; declares only what the bot uses
  framework/        gateway, event router, dedup, HTTP server, scheduler, lifecycle
  agent/            the seam with packages/agents
    client.ts         typed HTTP transport, retry semantics
    render/           renderer + Discord REST writer (nonce-enforced)
    hitl/             human-in-the-loop components and interaction handling
    scheduled.ts      scheduled-occurrence admission
  utils/
    conversation/     the reconciler (see below)
    dates.ts          wall-clock helpers for one timezone
  commands/         /ping /privacy /hack-night
  events/           agent chat, auto-thread, praise, ship + dashboard mirrors,
                    voice transcription, hack-night images, chat indexer
  schedules/        hack-night countdown, photography thread, cleanup
  integrations/     ships, dashboard, CMS, privacy DB, hack-night
scripts/
  register-commands.ts   explicit guild registration; never runs at startup
```

`framework/` is the reusable machinery — `defineEvent`, `defineCommand`, the router, dedup, the scheduler. Everything under `commands/`, `events/` and `schedules/` is userland written against it.

## The reconciler

`utils/conversation/` is the only thing that turns stored desired state into Discord effects and advances the queue. It is split by concern, with mutable lifecycle state held in `index.ts` and passed explicitly as `FlowRuntime` — which is what lets the other three files be independent:

| File        | Responsibility                                                            |
| ----------- | ------------------------------------------------------------------------- |
| `index.ts`  | `createConversationFlow` — started/stopped, pending sets, sweep scheduler |
| `queue.ts`  | inbound operations: submit, reset, HITL answer, schedule admit, parked    |
| `render.ts` | claim a dispatch, load its intent, paint it, record the applied revision  |
| `sweep.ts`  | the recovery loop over durable indexes                                    |
| `types.ts`  | shared shapes, no behavior                                                |

Sweep order is load-bearing: render first, so a durable terminal outcome exists before the queue transition tries to advance past a parked delivery.

## Rendering

`agent/render/` is the single writer for the agent's replies. Every write carries a nonce and checkpoints its projection, so a crash mid-paint resumes rather than duplicating. A terminal render outcome — `applied` or `discarded` — is the visible-commit barrier before the next queued turn may enter the agent.

The agent also calls Discord REST directly for its own domain tools. Those two clients keep independent rate-limit buckets on the same channel routes; both honour `retry_after`.

## Event handling

`framework/events.ts` attaches MessageCreate, MessageDelete, and both reaction events; `InteractionCreate` is attached separately for HITL and slash commands.

A message addresses the agent only when `<@bot>` starts the content, or it replies to a bot message inside a thread. Derived `mention` handlers run to completion before ordinary `message` handlers; siblings within a group run concurrently.

Before any filtering or side effect, each handler claims `dedup:<handler>:<eventKey>` in Redis with `NX PX 300000`. The handler name scopes the claim so sibling behaviors each see the same event. Five minutes covers gateway RESUME replay and brief deployment overlap. Redis failure fails closed and skips side effects.

## Timezone

The process runs **UTC**. Hack night is an Indiana event — a fact about the domain, not about whichever host runs the image — so the zone lives in `utils/dates.ts` as `TIME_ZONE` and is passed explicitly to `Intl` and to croner.

This matters most for `minuteId`, which is a cross-process coordination key: two bot instances claim a schedule fire by racing `SET NX` on the same key. If they disagreed about local time their keys would not collide, both claims would win, and the schedule would fire twice with no error anywhere.

## Running it

```bash
bun run dev      # watch mode, with the Sentry preload
bun run start    # production entrypoint
```

Guild commands register automatically after a merge to `main`. Manually:

```bash
CONFIRM_COMMAND_GUILD=772576325897945119 bun run register-commands
```

The script refuses to run unless that variable matches the guild id compiled into `@repo/shared/discord`, so a misconfigured environment cannot register somewhere else. The PUT replaces the whole command set, so repeating it is safe.

## Container

Host-agnostic. Build from the **repository root** so the shared workspace is in context:

```bash
docker build -f packages/bot/Dockerfile -t wack-hacker-bot .
```

It listens on `PORT` (default 8080) for the agent's render, parked and scheduled callbacks, and for liveness probes.
