# Wack Hacker

AI-powered Discord bot for [Purdue Hackers](https://purduehackers.com). Wack Hacker coordinates specialized subagents to manage many of our resources from Discord threads.

- **Talk to your tools.** @mention the bot in any thread to read and act on the services we use without leaving Discord.
- **Multi-turn memory.** Conversations persist across messages, restarts, and deploys, so you can come back to a thread hours later and pick up where you left off.
- **Full Discord surface.** First-class support for gateway events, slash commands, message components, modals, and cron jobs — write a handler, register it, ship it.
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

## Project structure

```
src/
  app/          Next.js routes (Hono catch-all + queue consumers)
  server/       Hono app: gateway, interactions, inbound, crons
  workflows/    Workflow DevKit definitions (chat, task)
  bot/          EventRouter, handlers, commands, components, crons
  lib/
    ai/
      orchestrator.ts   top-level agent
      subagent.ts       focused per-domain agent
      delegates.ts      role-filtered delegation tools
      skills/           per-domain SKILL.md trees + registry
      tools/            per-domain tool implementations
    tasks/      scheduled task registry
    protocol/   Packet types, codec, interaction verify

scripts/        compile-skills, register-commands
```

## Architecture

**Request flow**

```
                 ┌───────────┐    ┌───────────────┐
                 │  Discord  │───▶│ /interactions │
                 └───────────┘    └───────┬───────┘
                       ▲                  │
                       │                  │
                       ▼                  │
      ┌──────┐   ┌──────────┐             │
      │ cron │──▶│ /gateway │             │
      └──────┘   └─────┬────┘             │
                       │                  │
                       ▼                  │
             ┌──────────────────┐         │
             │   Vercel Queue   │         │
             │  discord-events  │         │
             └─────────┬────────┘         │
                       │                  │
                       ▼                  │
                  ┌─────────┐             │
                  │ /events │             │
                  └────┬────┘             │
                       │                  │
                       ▼                  │
                ┌─────────────┐           │
                │ EventRouter │           │
                └──────┬──────┘           │
                       │                  │
                       ▼                  ▼
                    handlers     interaction reply
                       │
                       ▼
      ┌───────────────────────────────────────────┐
      │              Vercel Workflows             │
      │  ┌────────────────┐   ┌────────────────┐  │
      │  │  chatWorkflow  │   │  taskWorkflow  │  │
      │  └────────┬───────┘   └────────▲───────┘  │
      └───────────┼────────────────────┼──────────┘
                  │                    │
                  │           ┌────────┴───────┐
                  │           │  Vercel Queue  │
                  │           │     tasks      │
                  │           └────────▲───────┘
                  ▼                    │
           ┌──────────────┐            │
           │ Orchestrator │────────────┘
           └──────┬───────┘
                  │
                  ▼
            Discord message
```

**Agents**

```
  ┌─────────────────────────────────────────────┐
  │  Orchestrator                               │
  │  Claude Sonnet 4.6 · via AI Gateway         │
  │                                             │
  │  tools                                      │
  │   · currentTime                             │
  │   · documentation                           │
  │   · scheduleTask                            │
  │   · listScheduled                           │
  │   · cancel                                  │
  │   · delegate_linear                         │
  │   · delegate_github                         │
  │   · delegate_discord                        │
  │   · delegate_notion                         │
  └──────────────────────┬──────────────────────┘
                         │
                         │ delegate_<domain>
                         │
                         ▼
  ┌─────────────────────────────────────────────┐
  │  Subagent                                   │
  │  Claude Sonnet 4.6 · via AI Gateway         │
  │                                             │
  │  tools                                      │
  │   · loadSkill <progressively unlocks>       │
  └─────────────────────────────────────────────┘
```

**Skill system (inside a subagent)**

```
          loadSkill("issues")
                  │
                  │ 
                  ▼
          ┌───────────────┐
          │ SkillRegistry │
          └───────┬───────┘
                  │ reads
                  ▼
  skills/<domain>/skills/<name>/SKILL.md
  ─────────────────────────────────────
  body  → returned to the model
  tools → registered as "active"
                  │
                  ▼
           ┌─────────────┐
           │ prepareStep │  scopes the ToolSet for step N+1
           └──────┬──────┘
                  │
                  ▼
          step N+1 sees the
         newly unlocked tools
```

## Skills

Skills live inside delegate subagents. Each domain has a top-level `SKILL.md` (used as the subagent's system prompt and as the delegation tool's description) plus a `skills/<sub-skill>/SKILL.md` tree that the subagent progressively loads through its `loadSkill` tool.

A SKILL.md has YAML frontmatter and a markdown body:

```yaml
---
name: <domain>
description: <short summary used in the delegation tool>
criteria: <when the orchestrator should pick this domain>
tools: [<tool_name>, ...]
minRole: organizer
mode: delegate
---
Skill instructions in markdown. For a domain's top-level SKILL.md, this body
becomes the subagent's system prompt (with {{SKILL_MENU}} substituted). For
a sub-skill SKILL.md, this body is returned when the subagent calls
loadSkill and the listed tools become active.
```

`bun scripts/compile-skills.ts` walks `src/lib/ai/skills/*/SKILL.md` and `src/lib/ai/skills/*/skills/*/SKILL.md` and emits a generated manifest plus per-domain sub-skill manifests under `src/lib/ai/skills/generated/`. The build runs this automatically.

### Adding a new delegate domain

1. Create `src/lib/ai/skills/<name>/SKILL.md` with `mode: delegate`. Include `{{SKILL_MENU}}` in the body where the sub-skill menu should be injected.
2. Add tool files under `src/lib/ai/tools/<name>/` and export them from `index.ts`.
3. Register the domain in `DOMAINS` inside `src/lib/ai/delegates.ts`.
4. Create `src/lib/ai/skills/<name>/skills/<sub>/SKILL.md` for each sub-skill, listing the tool names it unlocks.
5. Run `bun scripts/compile-skills.ts` (the build does this automatically).

### Adding a non-delegate top-level tool

Add the tool file under `src/lib/ai/tools/`, import it in `src/lib/ai/orchestrator.ts`, and add it to the `tools` object and the `<tools>` section of the system prompt. No skill file needed — top-level tools are flat.

### Admin-gated tools

Wrap any tool with `admin()` to restrict it to `UserRole.Admin`:

```ts
import { admin } from "@/lib/ai/skills/admin";

export const dangerous_tool = admin(
  tool({
    description: "...",
    inputSchema: z.object({
      /* ... */
    }),
    execute: async (input) => {
      /* ... */
    },
  }),
);
```

`filterAdmin()` strips these from the `ToolSet` passed to subagents when the user is not an admin.

## Deployment

`vercel.ts` configures:

- **Framework** `nextjs` so Vercel's function-pattern check recognizes `src/app/**/route.ts` paths.
- **Cron** `*/9 * * * *` → `/api/discord/gateway` keeps the gateway listener alive.
- **Queue triggers** (`queue/v2beta`) — topic `tasks` scoped to `src/app/api/tasks/route.ts`, topic `discord-events` scoped to `src/app/api/discord/events/route.ts`. Each route file compiles into its own `.func`, so triggers don't leak onto the rest of the Hono routes.
- **maxDuration: 600** on both queue consumers; the catch-all Hono function uses `max`.

Next.js compiles each route file into its own Vercel function. Fluid Compute handles concurrent invocations.

## Testing

Vitest with Istanbul coverage. Unit tests live next to the code they cover (`*.test.ts`). Integration tests use a separate config and the `*.integration.test.ts` suffix. Coverage excludes server routes, tool implementations, types, constants, and raw handler glue.
