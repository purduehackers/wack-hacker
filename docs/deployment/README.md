# Deployment

Wack Hacker deploys to Vercel as a Next.js App Router project running on Fluid Compute. There is no separate backend service — every entry point is a Vercel Function compiled from `src/app/**/route.ts`.

## Contents

| Doc                                      | Topic                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| [vercel.ts](./vercel-config.md)          | The typed project config: framework, cron, queue triggers, `maxDuration`.                  |
| [Functions and routes](./functions.md)   | How Next.js route files compile into Vercel Functions, and which route does what.          |
| [Environment variables](./env.md)        | Validation in `src/env.ts`, local pulling, grouping by purpose.                             |
| [Build pipeline](./build.md)             | What `bun run build` actually does and in what order.                                       |

## Deploying

Standard Vercel flow:

```bash
vercel             # preview
vercel --prod      # production
```

Or push to a branch wired to a Vercel project. Both queue topics, the cron, and per-function `maxDuration` settings are picked up from `vercel.ts` automatically — no Vercel dashboard config required.

## Things that bite

- **Forgetting to recompile skills.** If you edit a `SKILL.md` and don't run `compile-skills.ts`, your changes silently won't show up. `bun run build` does it automatically; the standalone dev server does not.
- **Slash command registration.** `register-commands.ts` runs at build time, not on deploy webhook fire. If you change a command's signature without bumping a build, Discord won't know.
- **Queue trigger scope leaks.** Always put queue consumers in their own route file. Putting them in the catch-all turns every Hono route into a queue consumer.
- **maxDuration limits.** 600s is a hard cap on the consumers; if an agent run takes longer, the queue will retry the message and you'll get duplicate executions. Watch for runaway tool loops.
- **Cron drift.** The gateway cron is `*/9 * * * *` (every 9 minutes), not `*/10`, so it overlaps with the 10-minute listener hold. Don't "round it up" to 10.
