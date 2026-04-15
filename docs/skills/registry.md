# SkillRegistry

`src/lib/ai/skills/registry.ts` defines `SkillRegistry`, instantiated with either the top-level manifest (for the orchestrator to discover delegates) or a per-domain manifest (for a subagent to discover sub-skills).

```ts
const topLevel   = new SkillRegistry(SKILL_MANIFEST);                    // delegates.ts
const domainReg  = new SkillRegistry(spec.subSkills);                    // subagent.ts
```

## API

| Method                        | Purpose                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `getAvailableSkills(role)`    | All skills whose `minRole` is ≤ the caller's role.                                       |
| `loadSkill(name, role)`       | Returns the `SkillBundle` if it exists and `minRole` is satisfied; otherwise `null`.     |
| `buildSkillMenu(role)`        | Renders the available skills as `<available_skills>` XML for injection into a system prompt. |

The role hierarchy is `public(0) < organizer(1) < admin(2)`, set by `ROLE_LEVEL` at the top of the file.

## buildSkillMenu output

```xml
<available_skills>
- issues: Manage Linear issues (use when: the user asks about creating, updating, or searching issues)
- comments: Post and edit comments on Linear entities (use when: the user wants to leave a comment)
- ...
</available_skills>
```

This block is substituted into the top-level `SKILL.md` body wherever `{{SKILL_MENU}}` appears — usually just once, near the top of the subagent's system prompt. Skills above the caller's `minRole` are filtered out before rendering, so a non-admin simply never learns that the admin-only skills exist.

## loadSkill behavior

`loadSkill(name, role)`:

1. Looks up the bundle by name. If missing, returns `null`.
2. Checks `ROLE_LEVEL[role] >= ROLE_LEVEL[skill.minRole]`. If not, returns `null`.
3. Otherwise returns the full `SkillBundle`, which includes the markdown body (`instructions`).

The `createLoadSkillTool` wrapper in `loader.ts` calls this and wraps the result in `<skill>` XML before returning it to the model. If `loadSkill` returns `null`, the tool instead returns an error string listing the available skill names so the model can correct itself.
