# vercel.ts

`vercel.ts` (at the repo root) is the typed project configuration. It replaces `vercel.json`.

```ts
import { type VercelConfig } from "@vercel/config/v1";

import { buildCronRoutes } from "@/bot/crons/config";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [{ path: "/api/discord/gateway", schedule: "*/9 * * * *" }, ...buildCronRoutes()],
  functions: {
    "src/app/api/tasks/route.ts": {
      maxDuration: 600,
      experimentalTriggers: [{ type: "queue/v2beta", topic: "tasks" }],
    },
    "src/app/api/discord/events/route.ts": {
      maxDuration: 600,
      experimentalTriggers: [{ type: "queue/v2beta", topic: "discord-events" }],
    },
    "src/app/api/[[...route]]/route.ts": {
      maxDuration: "max",
    },
  },
};
```

## Framework

`framework: "nextjs"` is what makes Vercel's function-pattern check recognize `src/app/**/route.ts` paths. Without it, the per-function configuration won't apply.

## Cron

Two sources:

1. **Gateway leader cron** — `*/9 * * * *` → `/api/discord/gateway`. Hand-registered because it lives outside the handler registry. Keeps something always trying to be the active discord.js client; the cadence overlaps with the listener's 10-minute hold so there's always a leader. See [Discord § gateway leader election](../discord/gateway.md).
2. **Handler-derived crons** — `buildCronRoutes()` (from `@/bot/crons/config`) walks `src/bot/handlers/crons/` and emits one `{ path: "/api/crons/<name>", schedule }` entry per `defineCron` handler. At time of writing that's `heartbeat`, `hack-night-create`, and `hack-night-cleanup`. Add a new cron by dropping a `defineCron` handler in that directory; no `vercel.ts` edit required. See [Discord § writing handlers](../discord/handlers.md).

## Queue triggers

Two queue topics are configured, each scoped to **exactly one** route file:

| Topic            | Route file                            | Purpose                                  |
| ---------------- | ------------------------------------- | ---------------------------------------- |
| `discord-events` | `src/app/api/discord/events/route.ts` | Gateway packets → `EventRouter`          |
| `tasks`          | `src/app/api/tasks/route.ts`          | Scheduled task wake-ups → `taskWorkflow` |

Scoping is critical. Next.js compiles each route file into its own `.func` directory, and queue triggers attach to a single function. If you scoped `experimentalTriggers` to the catch-all (`[[...route]]`), every Hono route would suddenly be a queue consumer.

## maxDuration

- `600` (10 minutes) on both queue consumers — long enough for an agent run with subagent delegation.
- `"max"` on the catch-all Hono function — Fluid Compute's plan maximum, since that's where streaming chat turns and long-running interactions live.
