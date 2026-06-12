# Orchestrator

`src/lib/ai/orchestrator.ts` exports `createOrchestrator(context: AgentContext)`, which returns a fresh `ToolLoopAgent` per turn.

| Field         | Value                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Model         | `anthropic/claude-sonnet-4.6` (via Vercel AI Gateway)                                                                   |
| System prompt | A static template; `context.buildInstructions()` substitutes `{{DATE}}` and appends an `<execution_context>` YAML block |
| Tools         | A flat object of base tools + role-filtered delegate tools                                                              |
| Telemetry     | `experimental_telemetry: { isEnabled: true, functionId: "orchestrator", metadata: { role } }`                           |

The orchestrator is **flat**: all tools are visible from the start — no `activeTools`, no skill gating (its only `prepareStep` re-marks the trailing message for prompt caching; see [Prompt caching](#prompt-caching)). Every call to `createOrchestrator` builds a brand new agent, so any state you want across turns has to live in `AgentContext` or the workflow payload, not the agent itself.

## Base tools

These are always present, regardless of role:

- **`documentation`** — search and quote from [ask.purduehackers.com](https://ask.purduehackers.com).
- **`resolve_organizer`** — authoritative name-to-platform-ID lookup for the Purdue Hackers organizer roster stored in Vercel Edge Config. Returns the caller's Discord/Linear/Notion/Sentry/GitHub/Figma IDs so the orchestrator can forward real IDs to delegates instead of free-text names. The `/identity` slash command is what writes into that roster. See `src/lib/protocol/organizers/` for the reader/writer.
- **`schedule_task`**, **`list_scheduled_tasks`**, **`cancel_task`** — scheduling tools that publish to, read from, or cancel jobs in the `tasks` queue. `schedule_task` and `cancel_task` are wrapped with [`approval()`](./approvals.md) so the user confirms via Discord buttons. See [Workflows § scheduled tasks](../workflows/scheduling.md).

## Delegate tools

`buildDelegationTools(role)` (in `src/lib/ai/delegates.ts`) iterates the `DOMAINS` registry. For each domain it:

1. Loads the top-level `SKILL.md` from the top-level `SkillRegistry`.
2. If `mode: delegate`, wraps it in a delegation tool via `createDelegationTool(spec, role)` — see [Delegation & subagents](./subagents.md).
3. Skips any domain whose skill's `minRole` exceeds the caller's `UserRole`.

The resulting tools are keyed by `delegate_<domain>` and merged into the orchestrator's tool object. A public user might see no delegate tools at all; an organizer sees everything above `organizer`; an admin additionally sees admin-marked tools inside each subagent (see [Skills § admin gating](../skills/admin.md)).

## System prompt

The static template is defined at the top of `orchestrator.ts`. It has five sections:

- `<identity>` — role, audience, first-person voice.
- `<date>` — `{{DATE}}`, `{{NOW_ISO}}`, `{{USER_TZ}}` placeholders that `buildInstructions` replaces with `context.date`, `context.nowISO`, and `context.timezone`. The ISO instant lets the model compute relative schedules ("in 10 minutes") without guessing; the IANA timezone defaults to `America/New_York` and gates interpretation of clock times. `nowISO` is minute-precision and pinned to the first turn within a chat workflow (a per-turn instant would bust the prompt cache); followup turns carry fresh time via a `[current time: …]` stamp on the user message.
- `<scheduling_rules>` — reminds the model to use the injected instant + timezone when computing schedules (preferring the latest `[current time: …]` stamp when present), and to emit `run_at` as a fully-qualified ISO 8601 string.
- `<tools>` — a human-readable description of the base and delegate tools, so the model knows when to pick each one. It covers the full 12-domain delegate set (listed in [Delegation & subagents](./subagents.md) along with their per-domain overrides); `delegate_code` is called out separately as admin-only. **When you add a base tool or a new delegate domain, update this section.**
- `<tone>`, `<formatting>` — output style rules (Discord markdown, 2000 char limit, no preamble, etc.).

`context.buildInstructions(SYSTEM_PROMPT)` additionally appends an `<execution_context>` YAML block with the user, channel, thread (if any), and date so the model has direct visibility into "who's talking and where".

## Prompt caching

The orchestrator always runs an Anthropic model, so its prompt is cached with explicit `cache_control` breakpoints (`src/lib/ai/cache-control.ts`): one on the last tool, applied once at agent construction in `createOrchestrator` (ai@6's `PrepareStepResult` has no `tools` field, so a per-step override would be silently ignored), and one on the trailing message, re-applied each step via `prepareStep`. Two breakpoints total, under Anthropic's limit of four.

Cache hits require the rendered prompt to be byte-stable, which is why the chat workflow pins `date`/`nowISO`/`timezone` (and the lead-in blocks plus their thread/channel tag) in its `StableScope`, `nowISO` is minute-precision, and the followup time stamp is persisted into conversation history. Per-turn cache reads/writes are logged on the `ai.turn` wide event (`cache_read_tokens` / `cache_write_tokens`), mirrored onto the `chat.turn` span, and recorded as `ai.turn.cache_read_tokens` / `ai.turn.cache_write_tokens` distributions — cache reads > 0 on step 2+ is the signal that the AI Gateway forwards `providerOptions.anthropic.cacheControl` for `anthropic/...` model strings.

Subagent prompts are deliberately **not** cached this way: 11/12 domains run OpenAI models, which do automatic server-side prefix caching, and `addCacheControl` no-ops for non-Anthropic models.

**Known limitation — multi-user threads.** The `<execution_context>` block renders the _current speaker_ (username/nickname/id), and the delegate tool set is gated by the speaker's role. Any user can send a followup in a tracked conversation, so a followup from a different author (or different role tier) legitimately changes the prompt and tools and takes a cache miss for that turn. This is intentional: pinning identity would misattribute followups, and pinning roles would be a privilege leak. Single-user threads — the dominant case — stay byte-stable across turns.
