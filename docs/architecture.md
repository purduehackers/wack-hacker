# Architecture

Wack Hacker is a Discord bot built on Next.js App Router + Hono, with AI SDK v6 for agents and Workflow DevKit for durability. Everything runs as Vercel Functions on Fluid Compute.

## System shape

Three things are happening at once:

1. **Inbound Discord traffic.** Discord events arrive over either a long-lived gateway WebSocket (kept alive by a cron-driven leader) or as signed HTTP interactions. Gateway events are encoded as `Packet`s and pushed onto a Vercel Queue (`discord-events`); a queue consumer drains them through the `EventRouter`. HTTP interactions take their own direct path and reply inline.
2. **Durable execution.** Anything that needs to outlive a single function invocation (multi-turn chats, scheduled tasks) runs inside a Workflow DevKit workflow. Workflows can suspend at hooks or sleeps and resume later, surviving redeploys.
3. **Agents.** When the bot is mentioned, a `chatWorkflow` runs `streamTurn`, which spawns the orchestrator agent. The orchestrator can delegate to focused per-domain subagents, which progressively load their own tools through the skill system.

## Request flow

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

- `cron → /gateway` keeps the discord.js client alive (see [Discord § gateway leader election](./discord/gateway.md)).
- The bidi arrow between `Discord` and `/gateway` is the WebSocket: events flow up, heartbeats and replies flow down.
- `/interactions` is HTTP and signature-verified; it never goes through the queue.
- `Orchestrator` publishes to the `tasks` queue when an agent calls `schedule_task`. The queue consumer (`/api/tasks`) starts a `taskWorkflow`, which can in turn spawn more agent runs at scheduled times.

## Agents

```
  ┌─────────────────────────────────────────────┐
  │  Orchestrator                               │
  │  Claude Sonnet 4.6 · via AI Gateway         │
  │                                             │
  │  tools                                      │
  │   · current_time                            │
  │   · documentation                           │
  │   · schedule_task                           │
  │   · list_scheduled_tasks                    │
  │   · cancel_task                             │
  │   · delegate_<domain>                       │
  └──────────────────────┬──────────────────────┘
                         │
                         │ delegate_<domain>
                         │
                         ▼
  ┌─────────────────────────────────────────────┐
  │  Subagent                                   │
  │  Claude Haiku 4.5 (default) · AI Gateway    │
  │                                             │
  │  tools                                      │
  │   · loadSkill <progressively unlocks>       │
  └─────────────────────────────────────────────┘
```

The orchestrator is **flat**: every tool it has is visible from the start, and there is no skill gating at the top level. Delegate tools forward a self-contained task to a focused subagent.

The subagent is **progressive**: it starts with `loadSkill` plus a small set of `baseToolNames` (typically discovery/search tools), and uses `loadSkill(name)` to read a sub-skill's instructions and unlock its tools for subsequent steps. This keeps the top-level context lean and the domain-level context rich but disclosure-gated.

See [Agents](./agents/README.md) for the full breakdown.

## Skill system (inside a subagent)

```
          loadSkill("issues")
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

`prepareStep` walks the subagent's step history every step, finds every previous `loadSkill` call, and computes the union of tool names those skills unlock. The resulting `activeTools` list is what the model sees on the next step. See [Skills](./skills/README.md).

## Storage and platform

| Service            | Purpose                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| AI Gateway         | `anthropic/claude-sonnet-4.6` (orchestrator) and `anthropic/claude-haiku-4.5` (subagents); routing, observability, model fallbacks |
| Upstash Redis      | `ConversationStore`, dedup keys, per-channel locks, task registry                                                                  |
| Turso (libSQL)     | Privacy preferences, ship submissions                                                                                              |
| Cloudflare R2      | Ship uploads                                                                                                                       |
| Payload CMS        | Hack night photo archive, curated site content (events, hack-night-sessions, ugrants, shelter projects)                            |
| Vercel Edge Config | Hack night `version` key (used by the `/init-hn` command)                                                                          |
| Vercel Queues      | `discord-events` (gateway → consumer), `tasks` (scheduling)                                                                        |

## Where things live

```
src/
  app/          Next.js routes (Hono catch-all + queue consumers)
  server/       Hono app + process-event dispatcher (gateway, interactions, crons)
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
vercel.ts       framework, crons, per-function config
```
