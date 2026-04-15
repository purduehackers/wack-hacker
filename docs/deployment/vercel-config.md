# vercel.ts

`vercel.ts` (at the repo root) is the typed project configuration. It replaces `vercel.json`.

```ts
import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  bunVersion: "1.x",
  crons: [{ path: "/api/discord/gateway", schedule: "*/9 * * * *" }],
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

`*/9 * * * *` → `/api/discord/gateway`. This is the gateway leader cron — it makes sure something is always trying to be the active discord.js client. The cadence overlaps with the listener's 10-minute hold, so there's always a leader. See [Discord § gateway leader election](../discord/gateway.md).

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

## Bun version

`bunVersion: "1.x"` pins the Bun runtime to the 1.x line. Update this when moving to 2.x.
