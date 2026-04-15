# Skills

Skills are the unit of progressive disclosure inside delegate subagents. The orchestrator does **not** use skills — it sees every tool it has at all times. Skills only matter once you're inside a subagent.

## Why skills exist

A delegate domain like Linear or GitHub can easily expose 50+ tools. Putting them all in one subagent's toolset has two problems:

1. **Token bloat** — every tool's description ships with every step.
2. **Decision paralysis** — the model spends compute deciding which of 50 tools to use when only 3 are relevant.

Skills break a domain into sub-skills (e.g. `issues`, `pull-requests`, `actions`). The subagent starts with a small set of `baseToolNames` (typically search/discovery tools) plus a `loadSkill` tool. When the model decides it needs to do something specific, it calls `loadSkill("issues")`, reads the instructions, and only then sees the tools that skill unlocks.

## Contents

| Doc                                       | Topic                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| [SKILL.md format](./skill-md.md)          | Frontmatter fields, top-level vs sub-skill, compilation.                          |
| [SkillRegistry](./registry.md)            | `SkillRegistry`, role filtering, `loadSkill`, `buildSkillMenu`.                   |
| [Progressive disclosure](./disclosure.md) | How `loadSkill` and `prepareStep` unlock tools inside a subagent.                 |
| [Admin gating](./admin.md)                | `admin()` wrapper and `filterAdmin()`.                                            |
| [Adding skills and domains](./adding.md)  | Adding a sub-skill to an existing domain or creating a whole new delegate domain. |

## Where to look in the code

| File                            | What it is                                                         |
| ------------------------------- | ------------------------------------------------------------------ |
| `src/lib/ai/skills/registry.ts` | `SkillRegistry`, `buildSkillMenu`, role gating                     |
| `src/lib/ai/skills/loader.ts`   | `createLoadSkillTool` — the `loadSkill` tool used inside subagents |
| `src/lib/ai/skills/runtime.ts`  | `computeActiveTools` — used by `prepareStep` to scan step history  |
| `src/lib/ai/skills/admin.ts`    | `admin()` wrapper and `filterAdmin()`                              |
| `src/lib/ai/skills/types.ts`    | `SkillMeta`, `SkillBundle`                                         |
| `src/lib/ai/skills/generated/`  | Compiled manifests (regenerate with `compile-skills.ts`)           |
| `scripts/compile-skills.ts`     | The compiler                                                       |
