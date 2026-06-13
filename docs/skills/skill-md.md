# SKILL.md format

A skill is a markdown file with YAML frontmatter.

```yaml
---
name: <domain>
description: <short summary used in the delegation tool>
criteria: <when the orchestrator should pick this domain>
routing: <optional cross-domain tie-breaker, top-level only>
baseTools: [<tool_name>, ...] # top-level delegate skills only
tools: [<tool_name>, ...] # sub-skills only
minRole: organizer
mode: delegate
---
Skill instructions in markdown. For a domain's top-level SKILL.md, this body
becomes the subagent's system prompt (with {{SKILL_MENU}} substituted). For
a sub-skill SKILL.md, this body is returned when the subagent calls
loadSkill and the listed tools become active.
```

## Frontmatter fields

| Field         | Meaning                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | Stable identifier; matches the directory name.                                                                                                                                                   |
| `description` | One-line summary; used in the orchestrator's delegation tool description and in `{{SKILL_MENU}}`.                                                                                                |
| `criteria`    | Plain English describing when this skill should be picked. Rendered into the delegation tool description and the orchestrator's delegate docs ("Use when: …"), and into `{{SKILL_MENU}}`.        |
| `routing`     | Optional, top-level only. Cross-domain tie-breakers that don't fit `criteria` (e.g. the Vercel-vs-Sentry boundary). Appended to the domain's line in the orchestrator's generated delegate docs. |
| `baseTools`   | Required for `mode: delegate`. The always-active discovery tools the subagent starts with, before any sub-skill is loaded. Names must match exports in `src/lib/ai/tools/<domain>/index.ts`.     |
| `tools`       | Sub-skills only. Array of tool names this skill unlocks. Names must match the actual tool exports in `src/lib/ai/tools/`.                                                                        |
| `minRole`     | Lowest role that can see this skill: `public`, `organizer`, or `admin`.                                                                                                                          |
| `mode`        | `delegate` (top-level domains only — wrapped in a delegation tool) or `inline` (sub-skills inside a subagent).                                                                                   |

The body is plain markdown. A top-level delegate `SKILL.md` **must** include `{{SKILL_MENU}}` somewhere in the body — the registry substitutes the role-filtered list of available sub-skills at runtime, and `compile-skills.ts` fails the build if the placeholder is missing. Don't hand-write sub-skill lists in the body; the generated menu is the single source of truth.

## Top-level vs sub-skill

Two layers of `SKILL.md` files exist:

```
src/lib/ai/skills/
  <domain>/
    SKILL.md              ← top-level: subagent system prompt + delegation tool description
    skills/
      <sub-skill>/
        SKILL.md          ← sub-skill: returned when the subagent calls loadSkill(<sub-skill>)
```

Both use the same frontmatter shape, just with different `mode` values. Top-level skills are always `mode: delegate` (the orchestrator wraps them in a delegation tool); sub-skills are always `mode: inline` (they unlock tools in the already-running subagent).

## Compilation

`scripts/compile-skills.ts` walks `src/lib/ai/skills/*/SKILL.md` and `src/lib/ai/skills/*/skills/*/SKILL.md` and emits TypeScript modules under `src/lib/ai/skills/generated/`:

- A top-level `manifest.ts` aggregating every domain's `SkillBundle`.
- One per-domain manifest under `generated/domains/<domain>.ts` for each domain's sub-skills.
- `domains.ts` — the full domain registry (`DOMAINS`): tool namespaces + sub-skill manifests + `baseTools`. Consumed by `delegates.ts`; importing it pulls in every tool implementation.
- `subskills.ts` — the data-only `DOMAIN_SUBSKILLS` table (manifests, no tool imports). Consumed by the context inspector.

The compiler also validates delegate skills: the body must contain `{{SKILL_MENU}}`, `baseTools` must be non-empty, a tool barrel must exist at `src/lib/ai/tools/<domain>/index.ts`, and no `SKILL.md` may reference `load_skill` (the tool is named `loadSkill`).

`bun run build` runs this automatically before `next build`. You can also run `bun scripts/compile-skills.ts` standalone after editing a `SKILL.md`.

The generated files are **gitignored** and rebuilt by `bun run build` (or `bun scripts/compile-skills.ts` standalone) — CI runs the compile step before typecheck, lint, and tests, and you must too when running them locally. If you edit a `SKILL.md` and forget to recompile, your changes won't show up at runtime — the generated file is the source of truth the agents actually read.
