# Wack Hacker

Wack Hacker is the AI-powered Discord bot for [Purdue Hackers](https://purduehackers.com). It coordinates specialized subagents to manage Linear, GitHub, Notion, and Discord — all from Discord threads.

Built on [Nitro](https://nitro.build) + [Hono](https://hono.dev), [AI SDK](https://ai-sdk.dev) v6, and [Workflow DevKit](https://useworkflow.dev). Deployed on Vercel with Fluid Compute.

## Architecture

```
Discord gateway (discord.js)
  → /api/discord/inbound (packet relay, deduped + channel-locked)
    → EventRouter dispatches Packet to registered handlers
      → mention handler → start(chatWorkflow)
        → Orchestrator ToolLoopAgent (Claude Sonnet 4.6 via AI Gateway)
          → Base tools: currentTime, documentation, schedule*
          → delegate_{linear,github,discord,notion} spawn focused subagents
            → Each subagent has its own sub-skill menu + loadSkill tool
              that progressively unlocks scoped domain tools
        → streamTurn edits the Discord message every 1.5s
      → Workflow hook suspends, awaits next mention
```

### Key patterns

- **Flat orchestrator, progressive subagents.** The orchestrator exposes every tool it has directly — no skill gating. Delegate subagents (`delegate_linear`, `delegate_github`, `delegate_discord`, `delegate_notion`) are top-level tools that forward a task to a focused nested `ToolLoopAgent`. Inside each subagent, progressive skill disclosure still applies: a `loadSkill` tool reads the domain's sub-skill manifest and `prepareStep` unlocks the matching tools for subsequent steps. The goal is a lean top-level context and a rich, disclosure-gated domain context.
- **Role-based access.** `UserRole.Public` gets base tools only. `UserRole.Organizer` additionally unlocks whichever delegate domains their role qualifies for (currently all four). `UserRole.Admin` additionally receives tools wrapped with `admin()`. Roles are resolved from Discord member role IDs in `AgentContext`; `buildDelegationTools(role)` filters delegates through the `SkillRegistry`.
- **Durable multi-turn chat.** `chatWorkflow` uses Workflow DevKit hooks to suspend between messages, surviving restarts and redeploys. Conversation state is persisted in Upstash Redis keyed by channel/thread.
- **Scheduled tasks.** `scheduleTask` enqueues to a Vercel Queue (`topic: "tasks"`) consumed by `/api/tasks`, which runs `taskWorkflow` to deliver a one-shot or recurring message/agent run.

## Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.10
- Upstash Redis
- Discord bot (gateway intents + interaction endpoint)
- GitHub App with org installation
- Linear API key, Notion integration token
- Vercel project (for Queues, Edge Config, Crons)
- Cloudflare R2 bucket (event archives, ship uploads)
- Turso / libSQL database (privacy + ship stores)

### Environment

```bash
cp .env.example .env
# Fill in all values
```

Env is validated by [`src/env.ts`](src/env.ts) using `@t3-oss/env-core` with the `vercel()` and `upstashRedis()` presets. Missing vars fail startup.

### Development

```bash
bun install
bun dev
```

Nitro dev server runs at `http://localhost:3000`. To take traffic you need to either:

- Hit `GET /api/discord/gateway` to spin up the discord.js gateway listener (it will relay packets to `/api/discord/inbound`), or
- Point Discord's **Interactions Endpoint URL** at `{BASE_URL}/api/discord/interactions` for slash commands and component callbacks.

### Scripts

| Command                  | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `bun dev`                | Start Nitro dev server                                         |
| `bun run build`          | Compile skills → Nitro build → register slash commands         |
| `bun run typecheck`      | `tsc --noEmit`                                                 |
| `bun run lint`           | `oxlint --type-aware`                                          |
| `bun run format`         | `oxfmt`                                                        |
| `bun run test`           | Unit tests (vitest)                                            |
| `bun run test:integration` | Integration tests                                            |
| `bun run test:coverage`  | Coverage report (90% threshold)                                |
| `bun run validate`       | `typecheck && lint && test`                                    |
| `bun run knip`           | Unused-code report                                             |

## Project structure

```
src/
  index.ts                        — Hono app (mounts /api/discord, /api/crons, /api/tasks)
  env.ts                          — Validated environment (T3 + Zod)

  server/
    routes/
      gateway.ts                  — discord.js client loop (cron: */9 * * * *)
      inbound.ts                  — Packet relay → EventRouter (dedup + lock)
      interactions.ts             — Slash commands + message components (signature verified)
      crons.ts                    — Cron dispatcher
      tasks.ts                    — Vercel Queue consumer
    workflows/
      chat.ts                     — Durable multi-turn conversation
      task.ts                     — Scheduled task execution
      types.ts                    — ChatPayload, TaskPayload

  lib/
    bot/
      router.ts                   — EventRouter (Packet → handler dispatch)
      store.ts                    — ConversationStore (Upstash Redis)
      mention.ts                  — Bot-mention detection + stripping
      types.ts                    — HandlerContext, ConversationState
      commands/                   — defineCommand + registry
      components/                 — defineComponent + routing by custom_id
      crons/                      — defineCron + registry
      events/                     — defineEvent helpers
      handlers/
        commands/                 — ping, privacy, delete-ship, door-opener, hack-night
        events/                   — mention, praise, voice-transcription, dashboard,
                                    auto-thread, ship-scraper, hack-night-upload, …
        crons/                    — periodic jobs
      integrations/               — external service clients

    ai/
      orchestrator.ts             — createOrchestrator(ctx): flat top-level ToolLoopAgent
      delegates.ts                — buildDelegationTools(role) → linear/github/discord/notion
                                    (role-filtered via SkillRegistry)
      subagent.ts                 — createDelegationTool: nested ToolLoopAgent with
                                    loadSkill-driven sub-skill disclosure + stream preview
      streaming.ts                — streamTurn: edits Discord message every 1.5s
      context.ts                  — AgentContext (user, channel, thread, role)
      constants.ts                — UserRole enum + Discord role IDs
      types.ts                    — SubagentSpec, SerializedAgentContext, …
      skills/
        index.ts                  — barrel
        registry.ts               — SkillRegistry, buildSkillMenu, role gating
        loader.ts                 — createLoadSkillTool (used inside subagents)
        runtime.ts                — computeActiveTools (scans subagent step history)
        admin.ts                  — admin() wrapper + filterAdmin()
        types.ts                  — SkillMeta, SkillBundle
        discord/      SKILL.md + skills/{channels,roles,members,messages,webhooks,
                                         events,threads,emojis}/SKILL.md
        github/       SKILL.md + skills/{repositories,issues,pull-requests,contents,
                                         actions,deployments,packages,projects,
                                         secrets-and-variables,organization}/SKILL.md
        linear/       SKILL.md + skills/{issues,issue-views,comments,projects,
                                         project-views,project-updates,initiatives,
                                         initiative-updates,documents,reminders,
                                         customer-requests,users}/SKILL.md
        notion/       SKILL.md + skills/{pages,databases,comments}/SKILL.md
        generated/                — compiled manifest + per-domain sub-manifests
      tools/
        discord/                  — base, channels, messages, roles, members,
                                    webhooks, events, threads, emojis, client
        github/                   — base, repositories, issues, pull-requests, …
        linear/                   — base, issues, issue-views, comments, …
        notion/                   — base, pages, databases, comments
        schedule/                 — scheduleTask, listScheduledTasks, cancelTask, time
        docs/                     — documentation (ask.purduehackers.com)
      tasks/                      — task execution helpers

    tasks/                        — TaskMeta registry + cron utilities
    protocol/                     — Packet types, codec, interaction verify
    test/fixtures/                — shared test fixtures

scripts/
  compile-skills.ts               — Builds skills/generated/{manifest,domains}.ts
  register-commands.ts            — Registers slash commands with Discord

vercel.ts                         — Cron + queue trigger config
nitro.config.ts                   — Nitro runtime + workflow module
```

## Skills

Skills exist only inside delegate subagents. Each delegate domain (linear, github, discord, notion) has a top-level `SKILL.md` (used as the subagent's system prompt + the top-level tool description) and a `skills/<sub-skill>/SKILL.md` tree that the subagent progressively loads via its own `loadSkill` tool.

A SKILL.md has YAML frontmatter and a markdown body:

```yaml
---
name: linear
description: Manage Linear issues, projects, and initiatives
criteria: When the user asks about issues, projects, cycles, or roadmaps in Linear
tools: [linear_search_issues, linear_get_issue, ...]
minRole: organizer
mode: delegate        # delegate-mode only; the orchestrator is flat
---

Full skill instructions in markdown. For a domain's top-level SKILL.md,
this body becomes the subagent's system prompt (with {{SKILL_MENU}}
substituted). For a sub-skill SKILL.md, this body is returned when the
subagent calls loadSkill and the listed tools become active.
```

The build step runs `bun scripts/compile-skills.ts`, which walks `src/lib/ai/skills/*/SKILL.md` and `src/lib/ai/skills/*/skills/*/SKILL.md`, and emits:

- `src/lib/ai/skills/generated/manifest.ts` — top-level delegate skills (consumed by `delegates.ts` to construct the delegation tools)
- `src/lib/ai/skills/generated/domains/{discord,github,linear,notion}.ts` — sub-skill manifests (consumed by each subagent's `SkillRegistry`)

### Adding a new delegate domain

1. Create `src/lib/ai/skills/<name>/SKILL.md` (top-level) with `mode: delegate`. The body should include `{{SKILL_MENU}}` where the sub-skill menu should be injected.
2. Add tool files under `src/lib/ai/tools/<name>/` and export them from `index.ts`.
3. Register the domain in `DOMAINS` inside `src/lib/ai/delegates.ts` (tools, sub-skill manifest import, `baseToolNames` for always-visible discovery tools).
4. Create `src/lib/ai/skills/<name>/skills/<sub>/SKILL.md` for each sub-skill, listing the tool names it unlocks.
5. Run `bun scripts/compile-skills.ts` (the build does this automatically).

### Adding a non-delegate top-level tool

Add the tool file under `src/lib/ai/tools/`, import it in `src/lib/ai/orchestrator.ts`, and add it to the `tools` object and the `<tools>` section of the system prompt. No skill file needed — top-level tools are flat.

### Admin-gated tools

Wrap any tool with `admin()` to restrict it to `UserRole.Admin`:

```ts
import { admin } from "@/lib/ai/skills/admin";

export const dangerous_tool = admin(tool({
  description: "...",
  inputSchema: z.object({ /* ... */ }),
  execute: async (input) => { /* ... */ },
}));
```

`filterAdmin()` strips these from the `ToolSet` passed to subagents when the user is not an admin.

## Deployment

`vercel.ts` configures:

- **Cron** `*/9 * * * *` → `/api/discord/gateway` keeps the gateway listener alive.
- **Queue trigger** (`queue/v2beta`, topic `tasks`) → `/api/tasks` consumes scheduled task jobs.

Nitro builds to `.output/` with the Vercel preset. Fluid Compute handles concurrent invocations; default function timeout is 300s (gateway route needs the 10-minute max configured in `nitro.config.ts`).

## Testing

Vitest with Istanbul coverage. Unit tests live next to the code they cover (`*.test.ts`). Integration tests use a separate config and the `*.integration.test.ts` suffix. Coverage excludes server routes, tool implementations, types, constants, and raw handler glue — the thresholds (90% lines) apply to the bot/AI core.
