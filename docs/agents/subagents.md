# Delegation & subagents

`createDelegationTool(spec, role)` in `src/lib/ai/subagent.ts` wraps a domain subagent as an AI SDK tool. The orchestrator calls the tool via `delegate_<domain>({ task })`, and the tool spawns a nested `ToolLoopAgent` to do the actual work.

## The async generator

The tool's `execute` is an **async generator**. It spawns the nested agent, listens to its `fullStream` via `readUIMessageStream`, and `yield`s `UIMessage` snapshots as they come in.

AI SDK surfaces those yielded values to the orchestrator's `streamTurn` as **preliminary** `tool-result` events, which `streamTurn` uses to render a live subagent preview in the Discord message while the subagent is still running.

When the subagent finishes, `toModelOutput()` runs and extracts only the final text part from the last `UIMessage`. Two transformations happen on the way out:

- If the run produced **no text at all**, the output is the honest `"Subagent returned no final text."` — never a fabricated success.
- The fenced ` ```entities ` trailer (see below) is stripped and re-rendered as a compact `Entities: [name](url) (type id), …` appendix, so canonical IDs survive into the orchestrator's context for follow-up delegations. When the model skipped the trailer, markdown links are harvested from the prose as a fallback.

This is what actually goes into the orchestrator's message history — the full subagent transcript is _not_ persisted, keeping the top-level context lean.

## Step-cap honesty

`stopWhen: stepCountIs(cap)` cuts the loop after the cap-th step. Three mechanisms keep that from being reported as a success:

1. **Forced wrap-up** — `prepareStep` returns `toolChoice: "none"` for the final step under the cap, so the model must spend it writing the mandated Summary/Answer instead of being cut mid-tool-call.
2. **Exhaustion message** — if the final step _still_ ended with `finishReason: "tool-calls"` (`detectExhaustion`), the generator yields a synthetic final message: `"Subagent stopped after N steps without completing the task. Last progress: …"`. For specs with a `postFinish`, the hook owns the final yield instead and receives `exhausted` / `hitStepCap` so it can label partial work (see [Code sandbox](./code-sandbox.md)).
3. **Metrics** — `ai.subagent.step_cap_hit` counts every cap-hit run; exhausted runs emit a wide event with `outcome: "exhausted"` instead of counting `ai.subagent.completed`; crashes emit `ai.subagent.error` (mid-run stream errors are captured via `readUIMessageStream`'s `onError` — the SDK does not throw them once a step has completed).

## Subagent configuration

| Field         | Value                                                                                                                                                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model         | `SUBAGENT_MODEL` in `src/lib/ai/constants.ts`, currently `openai/gpt-5.4-mini`; a domain can override via `DOMAIN_SPEC_OVERRIDES` (see below)                                                                                                                                                                                |
| Instructions  | `SUBAGENT_PREAMBLE` + the domain's `SKILL.md` body (with `{{SKILL_MENU}}` substituted) + `AgentContext.subagentContextBlock()` — a ~60-token block carrying the requesting user, channel, date, current instant, and timezone so verbatim-forwarded wording like "assign to me, due Friday" resolves without discovery calls |
| Tools         | All domain tools + `loadSkill`, then run through `filterAdmin(allTools)` when role is not admin, then `wrapApprovalTools` for any `approval()`-marked; Anthropic cache-control is layered at construction (`PrepareStepResult` has no `tools` key, so per-step application would be silently ignored)                        |
| `activeTools` | Initially `[...spec.baseToolNames, "loadSkill"]` — discovery tools plus the always-present `loadSkill`                                                                                                                                                                                                                       |
| `prepareStep` | Re-computes `activeTools` every step by scanning previous `loadSkill` calls (see [Skills](../skills/disclosure.md)); forces `toolChoice: "none"` on the final step under the cap                                                                                                                                             |
| `stopWhen`    | `stepCountIs(spec.stopSteps ?? 15)` — hard cap on tool calls per delegation, overridable per domain                                                                                                                                                                                                                          |
| Telemetry     | `experimental_telemetry: { isEnabled: true, functionId: "subagent.<name>", metadata: { role, subagent } }`                                                                                                                                                                                                                   |

## SubagentSpec

Each domain's `DOMAINS` entry in `src/lib/ai/delegates.ts` provides:

- `tools: ToolSet` — every tool the subagent **could** call.
- `subSkills: Record<string, SkillBundle>` — the per-domain sub-skill manifest (generated by `compile-skills.ts`).
- `baseToolNames: readonly string[]` — the discovery/search tools to activate on the first step.

At call time, `buildDelegationTools` layers on:

- `name` — the domain key (e.g. `"linear"`).
- `description` — from the domain's top-level `SKILL.md`, shown to the orchestrator on the delegation tool.
- `systemPrompt` — the same `SKILL.md` body, used as the subagent's instructions.

## Per-domain overrides (`DOMAIN_SPEC_OVERRIDES`)

Most subagents use the defaults. `delegates.ts` also exports a `DOMAIN_SPEC_OVERRIDES` map — a `Partial<Record<domain, Partial<SubagentSpec>>>` — for domains that need non-default wiring. The overridable fields are:

- `model` — swap the subagent model (e.g. a stronger one for harder tasks).
- `stopSteps` — raise or lower the per-delegation step cap.
- `inputSchema` + `getPrompt` — replace the default `{ task: string }` with a domain-specific Zod schema; the orchestrator sees the richer shape on the delegation tool. The two are a package deal: `SubagentPromptConfig` in `types.ts` is a neither-or-both union, so supplying a custom `inputSchema` without a `getPrompt` that extracts the prompt from it is a type error (there is no field-guessing fallback).
- `buildExperimentalContext` — a function that runs before the subagent starts. Whatever it returns is threaded into the agent's `experimental_context` and is visible to tools via `tool.execute`'s second argument. Use this to provision external state (a sandbox, a DB session, etc.).
- `postFinish` — an async generator that runs after the subagent emits its final message. It can yield more `UIMessage`s that stream back as the subagent's apparent last output (used, for example, to append a PR URL). It receives `exhausted` / `hitStepCap` and owns labeling partial work — the generic exhaustion message is suppressed so it can't clobber the hook's final yield.

Today only `code` has overrides. Its entry sets `model: "anthropic/claude-opus-4.7"`, `stopSteps: 60`, a repo-constrained `inputSchema` (`{ repo: "purduehackers/<name>", task: string }`) paired with `getCodeDelegationPrompt`, a `buildCodeExperimentalContext` that provisions a Vercel Sandbox session, and a `codePostFinish` that commits, pushes, and opens (or reuses) a PR. The full flow is documented in [Code sandbox](./code-sandbox.md).

## Fire-and-forget semantics

`SUBAGENT_PREAMBLE` (in `constants.ts`) sits at the top of every subagent's instructions and enforces three rules:

1. **Never ask questions.** Subagents run zero-shot with no way to receive follow-ups.
2. **Always complete the task.** No partial results, no asking for confirmation.
3. **Mandatory final format:** a `Summary` block followed by an `Answer` block, optionally followed by a fenced ` ```entities ` trailer — one `name | type | id | url` line per referenced entity. The trailer is the machine-readable handoff channel: raw IDs/UUIDs are required _there_ (and only there) so cross-domain chains ("file a Linear issue, then link it in the GitHub PR") don't force the orchestrator to re-extract handles from Discord-formatted prose. `toModelOutput` strips the block and appends the compact appendix described above.

The orchestrator relies on this contract — the delegate tool returns a single `toModelOutput` text blob, not a conversational exchange.
