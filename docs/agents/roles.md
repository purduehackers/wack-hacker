# Role-based access

`UserRole` is `"public" | "organizer" | "admin"`, defined as a `const` object in `src/lib/ai/constants.ts` (not a TypeScript enum because the workflow step bundle runs in strip-only type mode).

The mapping from Discord role IDs to `UserRole` lives in `src/lib/ai/context.ts` as the exported `roleFromMemberRoles()` helper (role IDs come from `DISCORD_IDS` in `src/lib/protocol/constants.ts`), and `AgentContext.role` resolves it lazily on each access:

```ts
export function roleFromMemberRoles(memberRoles?: readonly string[]): UserRole {
  if (!memberRoles) return UserRole.Public;
  if (memberRoles.includes(DISCORD_IDS.roles.ADMIN)) return UserRole.Admin;
  if (memberRoles.includes(DISCORD_IDS.roles.ORGANIZER)) return UserRole.Organizer;
  return UserRole.Public;
}
```

The helper is shared with call sites that only have a raw roles array: the approval button handler (second-party clicks) and the scheduled-fire role re-resolution.

## How the role is enforced

The same orchestrator code runs for every user — access control is enforced at the toolset level rather than via prompt instructions. Three gates apply:

- **`buildDelegationTools(role)`** (in `delegates.ts`) filters which domains the orchestrator sees. Domains whose top-level `SKILL.md` has a `minRole` higher than the caller are dropped before the orchestrator is even constructed.
- **[`applyPolicy(tools, …)`](policy.md)** (in `policy/apply.ts`) enforces each tool's `access()` descriptor. Tools whose effective `minRole` exceeds the caller's role are omitted entirely — deny-by-absence, so non-eligible users literally never see the tool. The effective `minRole` comes from the role×risk defaults table (read→public, write/destructive→organizer) unless the descriptor overrides it (e.g. `minRole: "admin"`). Both the orchestrator's base ToolSet and every subagent's domain ToolSet pass through this gate.
- **`SkillRegistry.getAvailableSkills(role)`** filters sub-skills by `minRole` so they don't even appear in `{{SKILL_MENU}}`. The sub-skill menu is role-specific, and `loadSkill(name)` will also reject any name that exists but is above the caller's role.

The gates stack: a skill can be visible to organizers while still containing individual admin-only tools. Each applies independently.

Policy adds one more role-sensitive dimension: `public` users carry a daily token budget (`decide()` denies once it's exhausted); organizers and admins are exempt. See [Access policy § budgets](policy.md#budgets).

## Role hierarchy

```
public    (0)
organizer (1)
admin     (2)
```

The numeric levels live in `ROLE_LEVEL` constants in `src/lib/ai/skills/registry.ts` (skill gating) and `src/lib/ai/policy/decide.ts` (tool gating, exposed as `roleAtLeast()`).

## Roles are resolved fresh

Because `memberRoles` is fresh per turn, `role` correctly reflects the current sender — and scheduled tasks re-resolve the creator's current roles at fire time rather than trusting the snapshot taken at schedule time. A user de-roled in Discord loses organizer-powered scheduled runs at the next fire (the stored snapshot is only a fallback for Discord outages). See [Access policy § scheduled tasks](policy.md#scheduled-tasks).

## Where to change the mapping

The role IDs are hardcoded to the Purdue Hackers Discord guild in `DISCORD_IDS.roles` (`src/lib/protocol/constants.ts`). Change them there if role IDs change upstream.
