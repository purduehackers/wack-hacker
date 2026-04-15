# Orchestrator

`src/lib/ai/orchestrator.ts` exports `createOrchestrator(context: AgentContext)`, which returns a fresh `ToolLoopAgent` per turn.

| Field         | Value                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Model         | `anthropic/claude-sonnet-4.6` (via Vercel AI Gateway)                                                                  |
| System prompt | A static template; `context.buildInstructions()` substitutes `{{DATE}}` and appends an `<execution_context>` YAML block |
| Tools         | A flat object of base tools + role-filtered delegate tools                                                             |
| Telemetry     | `experimental_telemetry: { isEnabled: true, functionId: "orchestrator", metadata: { role } }`                          |

The orchestrator is **flat**: all tools are visible from the start. There is no `prepareStep`, no `activeTools`, no skill gating. Every call to `createOrchestrator` builds a brand new agent, so any state you want across turns has to live in `AgentContext` or the workflow payload, not the agent itself.

## Base tools

These are always present, regardless of role:

- **`currentTime`** — current wall clock and timezone, used for date math.
- **`documentation`** — search and quote from [ask.purduehackers.com](https://ask.purduehackers.com).
- **`scheduleTask`**, **`listScheduledTasks`**, **`cancelTask`** — scheduling tools that publish to, read from, or cancel jobs in the `tasks` queue. See [Workflows § scheduled tasks](../workflows/scheduling.md).

## Delegate tools

`buildDelegationTools(role)` (in `src/lib/ai/delegates.ts`) iterates the `DOMAINS` registry. For each domain it:

1. Loads the top-level `SKILL.md` from the top-level `SkillRegistry`.
2. If `mode: delegate`, wraps it in a delegation tool via `createDelegationTool(spec, role)` — see [Delegation & subagents](./subagents.md).
3. Skips any domain whose skill's `minRole` exceeds the caller's `UserRole`.

The resulting tools are keyed by `delegate_<domain>` and merged into the orchestrator's tool object. A public user might see no delegate tools at all; an organizer sees everything above `organizer`; an admin additionally sees admin-marked tools inside each subagent (see [Skills § admin gating](../skills/admin.md)).

## System prompt

The static template is defined at the top of `orchestrator.ts`. It has four sections:

- `<identity>` — role, audience, first-person voice.
- `<date>` — a `{{DATE}}` placeholder that `buildInstructions` replaces with `context.date`.
- `<tools>` — a human-readable description of the base and delegate tools, so the model knows when to pick each one. **When you add a base tool, update this section.**
- `<tone>`, `<formatting>` — output style rules (Discord markdown, 2000 char limit, no preamble, etc.).

`context.buildInstructions(SYSTEM_PROMPT)` additionally appends an `<execution_context>` YAML block with the user, channel, thread (if any), and date so the model has direct visibility into "who's talking and where".
