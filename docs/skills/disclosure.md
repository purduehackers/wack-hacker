# Progressive disclosure

Progressive disclosure is the mechanism that lets a subagent start with a small toolset and expand it on demand. It's implemented by three cooperating pieces: `activeTools` on the subagent, the `loadSkill` tool, and `prepareStep`.

## The flow

Once a delegation tool fires, the subagent looks like this:

1. **Initial state**: `activeTools = [...baseToolNames, "loadSkill"]`. The `baseToolNames` are configured per-domain in `delegates.ts` and are typically the discovery/search tools — for Linear, that's `search_entities`, `retrieve_entities`, `suggest_property_values`, `aggregate_issues`. `loadSkill` is always appended automatically.
2. **Step N**: model calls `loadSkill("<name>")`.
3. **`loader.ts`** (`createLoadSkillTool`) returns the skill body wrapped in XML:

    ```xml
    <skill name="...">
    <description>...</description>
    <criteria>...</criteria>
    <instructions>
    ...the markdown body...
    </instructions>
    <tools>tool1, tool2, ...</tools>
    </skill>
    ```

    If the skill doesn't exist or the role is too low, it returns an error string listing the available skill names instead — the model can see what went wrong and retry.
4. **`prepareStep`** runs before step N+1. It calls `computeActiveTools({ steps, registry, role, baseToolNames })` (`runtime.ts`), which scans the step history for every prior `loadSkill` call, resolves each skill name against the registry, and unions the resulting tool names with `baseToolNames`. If no skills have been loaded yet, `computeActiveTools` returns `undefined` and the subagent stays on the initial `activeTools`.
5. **Step N+1**: the model now sees the newly unlocked tools in its `activeTools` and can call them.

A subagent can call `loadSkill` more than once during a single run — each call adds to the active set, never removes. The `stopWhen: stepCountIs(15)` cap puts a hard ceiling on runaway loops.

## computeActiveTools

```ts
function computeActiveTools<T extends ToolSet>(options: {
  steps: ReadonlyArray<StepResult<T>>;
  registry: SkillRegistry;
  role: UserRole;
  baseToolNames: readonly string[];
  skillToTools?: (skill: SkillBundle) => readonly string[];
}): string[] | undefined
```

The `skillToTools` override exists for tests and hypothetical non-standard skill shapes — in production, `skill.toolNames` is always the answer.

The function iterates step history, collects every `loadSkill` call's `input.name`, and for each unique name calls `registry.loadSkill(name, role)`. Any name that doesn't resolve (unknown or above the caller's role) is silently skipped — role enforcement is idempotent this way.

## prepareStep wiring

Inside `createDelegationTool`:

```ts
prepareStep: ({ steps }) => {
  const active = computeActiveTools({ steps, registry, role, baseToolNames });
  return active ? { activeTools: active as ToolKey[] } : undefined;
}
```

Returning `undefined` tells the agent to keep its current `activeTools`, so the initial `[...baseToolNames, "loadSkill"]` sticks until the model actually loads something.
