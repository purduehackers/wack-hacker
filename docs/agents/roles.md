# Role-based access

`UserRole` is `"public" | "organizer" | "admin"`, defined as a `const` object in `src/lib/ai/constants.ts` (not a TypeScript enum because the workflow step bundle runs in strip-only type mode).

The mapping from Discord role IDs to `UserRole` lives in `src/lib/ai/context.ts` under a private `ROLE_IDS` constant, and `AgentContext.role` resolves it lazily on each access:

```ts
get role(): UserRole {
  if (!this.memberRoles) return UserRole.Public;
  if (this.memberRoles.includes(ROLE_IDS.ADMIN))     return UserRole.Admin;
  if (this.memberRoles.includes(ROLE_IDS.ORGANIZER)) return UserRole.Organizer;
  return UserRole.Public;
}
```

## How the role is enforced

The same orchestrator code runs for every user — access control is enforced at the toolset level rather than via prompt instructions. Three gates apply:

- **`buildDelegationTools(role)`** (in `delegates.ts`) filters which domains the orchestrator sees. Domains whose top-level `SKILL.md` has a `minRole` higher than the caller are dropped before the orchestrator is even constructed.
- **`filterAdmin(toolSet)`** (in `skills/admin.ts`) strips tools wrapped with `admin()` if the role isn't `"admin"`. Subagents call `filterAdmin` against their domain's full toolset before passing it to the nested agent, so non-admins literally never see the tool.
- **`SkillRegistry.getAvailableSkills(role)`** filters sub-skills by `minRole` so they don't even appear in `{{SKILL_MENU}}`. The sub-skill menu is role-specific, and `loadSkill(name)` will also reject any name that exists but is above the caller's role.

The three gates stack: a skill can be visible to organizers while still containing individual admin-only tools. Both gates apply independently.

## Role hierarchy

```
public    (0)
organizer (1)
admin     (2)
```

The numeric levels live in `ROLE_LEVEL` inside `src/lib/ai/skills/registry.ts` and are used for `minRole` comparisons.

## Where to change the mapping

The `ROLE_IDS` block is hardcoded to the Purdue Hackers Discord guild:

```ts
const ROLE_IDS = {
  ORGANIZER: "1012751663322382438",
  ADMIN: "1344066433172373656",
} as const;
```

Change it in `src/lib/ai/context.ts` if role IDs change upstream.
