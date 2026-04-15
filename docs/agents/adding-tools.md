# Adding a base tool to the orchestrator

Base tools are flat — they're available to the orchestrator at all times, without going through the skill system. Use this path for tools that are either not domain-specific (`currentTime`, `documentation`) or that are cross-cutting utilities the orchestrator should always reach for directly (`scheduleTask`, `cancelTask`).

## Steps

1. **Create the tool file** under `src/lib/ai/tools/<group>/`, exporting an AI SDK `tool({ description, inputSchema, execute })`. Use `z.object(...)` for the input schema; the `execute` function takes that object's inferred type.
2. **Import it** in `src/lib/ai/orchestrator.ts` and add it to the `tools` object in `createOrchestrator`.
3. **Mention it** in the `<tools>` section of the orchestrator's `SYSTEM_PROMPT` so the model knows when to use it. The section is plain markdown; follow the format of the existing entries.
4. **Write a test** under `src/lib/ai/tools/<group>/<tool>.test.ts`. The tools directory is excluded from coverage thresholds, but a unit test on the `execute` function catches regressions.

No `SKILL.md` is needed for top-level tools — skills only exist inside subagents.

## When to use a delegate domain instead

If your tool belongs to a specific service (Linear, GitHub, …) that already has a subagent, add it there — see [Skills § adding a sub-skill](../skills/adding.md#adding-a-sub-skill-to-an-existing-domain). Base tools are for the orchestrator's flat toolkit, not domain-specific functionality.

## When to wrap in `admin()`

If the tool is destructive or should only be callable by admins, wrap it:

```ts
import { admin } from "@/lib/ai/skills/admin";

export const dangerous_tool = admin(
  tool({
    /* ... */
  }),
);
```

Note that the orchestrator's base tool object is **not** run through `filterAdmin` — that filter only applies inside subagents. If you want a base tool to be admin-gated, you'll need to conditionally add it to the `tools` object in `createOrchestrator` based on `context.role`, or move it into a delegate domain where `filterAdmin` does apply.
