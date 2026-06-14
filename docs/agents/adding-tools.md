# Adding a base tool to the orchestrator

Base tools are flat — they're available to the orchestrator at all times, without going through the skill system. Use this path for tools that are either not domain-specific (`documentation`, `resolve_organizer`) or that are cross-cutting utilities the orchestrator should always reach for directly (`schedule_task`, `cancel_task`).

## Steps

1. **Create the tool file** under `src/lib/ai/tools/<group>/`, exporting a tool authored with `defineTool({ name, domain, description, access, input, execute })`. Use `z.object(...)` for `input`; the `execute` function takes that object's inferred type. `name` must match the export, and base tools use `domain: "core"`.
2. **Import it** in `src/lib/ai/orchestrator.ts` and add it to the `tools` object in `createOrchestrator`.
3. **Mention it** in the `<tools>` section of the orchestrator's `SYSTEM_PROMPT` so the model knows when to use it. The section is plain markdown; follow the format of the existing entries.
4. **Write a test** under `src/lib/ai/tools/<group>/<tool>.test.ts`. The tools directory is excluded from coverage thresholds, but a unit test on the `execute` function catches regressions.

No `SKILL.md` is needed for top-level tools — skills only exist inside subagents.

## When to use a delegate domain instead

If your tool belongs to a specific service (Linear, GitHub, …) that already has a subagent, add it there — see [Skills § adding a sub-skill](../skills/adding.md#adding-a-sub-skill-to-an-existing-domain). Base tools are for the orchestrator's flat toolkit, not domain-specific functionality.

## Declaring access

Every tool must declare an [`access` spec](./policy.md) in its `defineTool` call — the `access-coverage` test fails any export without one:

```ts
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/_shared/define-tool";

export const dangerous_tool = defineTool({
  name: "dangerous_tool",
  domain: "core",
  description: "…",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    /* ... */
  }),
  execute: async (input, ctx) => {
    /* ... */
  },
});
```

`risk` is required (`"read"`, `"write"`, or `"destructive"`); `minRole` and `confirm` default by risk (read→public, write/destructive→organizer; destructive→self-confirmation via the Discord [approval flow](./approvals.md)). Base tools and subagent tools are gated identically — `getOrchestratorTools` runs the whole base ToolSet through `applyPolicy`, so admin-gating a base tool is just `minRole: "admin"` (see `list_audit_log` for a live example).
