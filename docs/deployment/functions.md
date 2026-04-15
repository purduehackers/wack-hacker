# Functions and routes

Next.js compiles each `route.ts` into its own Vercel Function. Fluid Compute reuses function instances across concurrent requests, so cold starts are rare and concurrent invocations can share in-memory state (e.g. for connection pooling).

## Routes

| Route                                 | What runs there                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/app/api/[[...route]]/route.ts`   | Hono catch-all: mounts `/api/discord/gateway`, `/api/discord/interactions`, `/api/crons/:name`. |
| `src/app/api/discord/events/route.ts` | Standalone queue consumer for `discord-events` (calls `processEvent` → `EventRouter`).          |
| `src/app/api/tasks/route.ts`          | Standalone queue consumer for `tasks` (wakes a `taskWorkflow`).                                  |

## Why two consumers exist as standalone files

Queue triggers attach per-function, and the catch-all is meant for HTTP traffic. Splitting them keeps the trigger config narrow — if you put `experimentalTriggers` on the catch-all, every Hono route would become a queue consumer and start processing messages that were meant for `tasks` or `discord-events`.

There are also two practical benefits:

- **Isolated timeouts** — the queue consumers have `maxDuration: 600`, but the catch-all uses `"max"` for streaming chat. Keeping them in separate files lets each one pick its own limit.
- **No request/response plumbing** — queue consumers don't have a real HTTP client; they use `handleCallback` to register their processing function. Mixing that into a Hono router would be awkward.

## Compiled output

Each route file compiles into its own `.vercel/output/functions/<route>.func` directory, with its own `.vc-config.json` reflecting the `maxDuration` and `experimentalTriggers` settings. You can inspect these after `bun run build` to verify that the trigger scoping worked.
