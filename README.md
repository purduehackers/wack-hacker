# Wack Hacker

AI-powered Discord bot for [Purdue Hackers](https://purduehackers.com). Wack Hacker coordinates specialized subagents to manage many of our resources from Discord threads.

- **Talk to your tools.** @mention the bot in any thread to read and act on the services we use without leaving Discord.
- **Multi-turn memory.** Conversations persist across messages, restarts, and deploys, so you can come back to a thread hours later and pick up where you left off.
- **Full Discord surface.** First-class support for gateway events, slash commands, message components, and cron jobs — write a handler, register it, ship it.
- **Scheduling.** Ask the bot to remind you, post on a schedule, or run a task once at a specific time. Recurring jobs survive redeploys.
- **Role-aware capabilities.** Public users get safe read tools; organizers unlock writes across our stack; admins get destructive operations. Permissions follow your Discord role.

### Domains

- **Discord** — manage channels, threads, messages, members, roles, emojis, webhooks, and scheduled events.
- **GitHub** — browse and edit repositories, file issues and PRs, read file contents, trigger workflows, manage deployments, packages, projects, secrets, and org settings.
- **Linear** — create and triage issues, run views, comment, manage projects, initiatives, updates, documents, reminders, customer requests, and users.
- **Notion** — read and write pages, query and update databases, post and resolve comments.
- **Documentation** — search and quote from [ask.purduehackers.com](https://ask.purduehackers.com) so the bot can answer questions grounded in Purdue Hackers' own docs.

Built on [Next.js](https://nextjs.org) App Router + [Hono](https://hono.dev) (via `hono/vercel`), [AI SDK](https://ai-sdk.dev) v6, and [Workflow DevKit](https://useworkflow.dev). Deployed on Vercel with Fluid Compute.

## Setup

### Prerequisites

- [Bun](https://bun.com) >= 1.3.10

### Environment

```bash
bunx vercel env pull --yes
```

Env is validated by [`src/env.ts`](src/env.ts) using `@t3-oss/env-core`.

### Development

```bash
bun install
bun dev
```

Next.js dev server runs at `http://localhost:3000`. To take traffic you need to either:

- Hit `GET /api/discord/gateway` to spin up the discord.js gateway listener (it will publish packets to the `discord-events` queue, consumed by `/api/discord/events`), or
- Point Discord's **Interactions Endpoint URL** at `{BASE_URL}/api/discord/interactions` for slash commands and component callbacks.

### Scripts

| Command                    | Description                                             |
| -------------------------- | ------------------------------------------------------- |
| `bun dev`                  | Start Next.js dev server                                |
| `bun run build`            | Compile skills → `next build` → register slash commands |
| `bun run typecheck`        | `tsc --noEmit`                                          |
| `bun run lint`             | `oxlint --type-aware`                                   |
| `bun run format`           | `oxfmt`                                                 |
| `bun run test`             | Unit tests (vitest)                                     |
| `bun run test:integration` | Integration tests                                       |
| `bun run test:coverage`    | Coverage report (90% threshold)                         |
| `bun run validate`         | `typecheck && lint && test`                             |
| `bun run knip`             | Unused-code report                                      |

## Documentation

Reference docs for the codebase live in [`docs/`](./docs/):

- [Architecture](./docs/architecture.md) — system shape, request flow, agent hierarchy, skill system.
- [Discord layer](./docs/discord/README.md) — gateway, interactions, `EventRouter`, queue consumer, handler patterns.
- [Agents](./docs/agents/README.md) — orchestrator, delegate subagents, `AgentContext`, streaming, role gating.
- [Skills](./docs/skills/README.md) — `SKILL.md` format, registry, progressive disclosure, admin gating, adding skills.
- [Workflows & scheduling](./docs/workflows/README.md) — `chatWorkflow`, `taskWorkflow`, hooks, recurring jobs.
- [Deployment](./docs/deployment/README.md) — `vercel.ts`, queue triggers, environment variables, build pipeline.
- [Testing](./docs/testing.md) — Vitest, integration suite, coverage thresholds.
