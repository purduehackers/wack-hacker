# SKILL.md format

A skill is a markdown file with YAML frontmatter.

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

## Frontmatter fields

| Field         | Meaning                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `name`        | Stable identifier; matches the directory name.                                                                 |
| `description` | One-line summary; used in the orchestrator's delegation tool description and in `{{SKILL_MENU}}`.              |
| `criteria`    | Plain English describing when this skill should be picked. Helps the model route correctly.                   |
| `tools`       | Array of tool names this skill unlocks. Names must match the actual tool exports in `src/lib/ai/tools/`.      |
| `minRole`     | Lowest role that can see this skill: `public`, `organizer`, or `admin`.                                       |
| `mode`        | `delegate` (top-level domains only — wrapped in a delegation tool) or `inline` (sub-skills inside a subagent).|

The body is plain markdown. For a domain's top-level `SKILL.md`, you can include `{{SKILL_MENU}}` anywhere — the registry will substitute the role-filtered list of available sub-skills at runtime.

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

`bun run build` runs this automatically before `next build`. You can also run `bun scripts/compile-skills.ts` standalone after editing a `SKILL.md`.

The generated files are **committed** to the repo (so type-checking and tests work without running the compile step). If you edit a `SKILL.md` and forget to recompile, your changes won't show up at runtime — the generated file is the source of truth the agents actually read.
