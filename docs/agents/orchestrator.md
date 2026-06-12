# Orchestrator

`src/lib/ai/orchestrator.ts` exports `createOrchestrator(context: AgentContext)`, which returns a fresh `ToolLoopAgent` per turn.

| Field         | Value                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model         | `anthropic/claude-sonnet-4.6` (via Vercel AI Gateway)                                                                                                                                                             |
| System prompt | `buildSystemPrompt(context)` — substitutes the generated `{{DELEGATES}}` section for the caller's role, then `context.buildInstructions()` substitutes `{{DATE}}` and appends an `<execution_context>` YAML block |
| Tools         | A flat object of base tools + role-filtered delegate tools                                                                                                                                                        |
| Telemetry     | `experimental_telemetry: { isEnabled: true, functionId: "orchestrator", metadata: { role } }`                                                                                                                     |

The orchestrator is **flat**: all tools are visible from the start. There is no `prepareStep`, no `activeTools`, no skill gating. Every call to `createOrchestrator` builds a brand new agent, so any state you want across turns has to live in `AgentContext` or the workflow payload, not the agent itself.

## Base tools

These are always present, regardless of role:

- **`documentation`** — search and quote from [ask.purduehackers.com](https://ask.purduehackers.com).
- **`resolve_organizer`** — authoritative name-to-platform-ID lookup for the Purdue Hackers organizer roster stored in Vercel Edge Config. Returns the caller's Discord/Linear/Notion/Sentry/GitHub/Figma IDs so the orchestrator can forward real IDs to delegates instead of free-text names. The `/identity` slash command is what writes into that roster. See `src/lib/protocol/organizers/` for the reader/writer.
- **`schedule_task`**, **`list_scheduled_tasks`**, **`cancel_task`** — scheduling tools that publish to, read from, or cancel jobs in the `tasks` queue. `schedule_task` and `cancel_task` are wrapped with [`approval()`](./approvals.md) so the user confirms via Discord buttons. See [Workflows § scheduled tasks](../workflows/scheduling.md).

## Delegate tools

`buildDelegationTools(role)` (in `src/lib/ai/delegates.ts`) iterates the generated `DOMAINS` registry (`src/lib/ai/skills/generated/domains.ts`, emitted by `compile-skills.ts`). For each domain it:

1. Loads the top-level `SKILL.md` from the top-level `SkillRegistry`.
2. If `mode: delegate`, wraps it in a delegation tool via `createDelegationTool(spec, role)` — see [Delegation & subagents](./subagents.md).
3. Skips any domain whose skill's `minRole` exceeds the caller's `UserRole`.

The resulting tools are keyed by `delegate_<domain>` and merged into the orchestrator's tool object. A public user might see no delegate tools at all; an organizer sees everything above `organizer`; an admin additionally sees admin-marked tools inside each subagent (see [Skills § admin gating](../skills/admin.md)).

## System prompt

The static template (`SYSTEM_PROMPT`) lives in `src/lib/ai/constants.ts`; `buildSystemPrompt(context)` in `orchestrator.ts` renders it per turn. It has five sections:

- `<identity>` — role, audience, first-person voice.
- `<date>` — `{{DATE}}`, `{{NOW_ISO}}`, `{{USER_TZ}}` placeholders that `buildInstructions` replaces with `context.date`, `context.nowISO`, and `context.timezone`. The ISO instant lets the model compute relative schedules ("in 10 minutes") without guessing; the IANA timezone defaults to `America/New_York` and gates interpretation of clock times.
- `<scheduling_rules>` — reminds the model to use the injected instant + timezone when computing schedules, and to emit `run_at` as a fully-qualified ISO 8601 string.
- `<tools>` — a hand-written description of the base tools, plus a `{{DELEGATES}}` placeholder that `buildSystemPrompt` fills with `buildDelegateDocs(role)`: one generated line per delegate the role can actually see (`description`, `criteria`, optional `routing` from each domain's `SKILL.md`), followed by the hand-written delegation rules. Roles with no delegates (public) get no delegation docs at all. **When you add a base tool, update the hand-written part; new delegate domains document themselves.**
- `<tone>`, `<formatting>` — output style rules (Discord markdown, 2000 char limit, no preamble, etc.).

`buildSystemPrompt` additionally appends an `<execution_context>` YAML block (via `context.buildInstructions`) with the user, channel, thread (if any), and date so the model has direct visibility into "who's talking and where". The context inspector's snapshot (`snapshot.ts`) calls the same `buildSystemPrompt`, so `/inspect-context` always shows the prompt the orchestrator actually ran with.
