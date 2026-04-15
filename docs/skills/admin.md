# Admin gating

`src/lib/ai/skills/admin.ts` exports two helpers: `admin()` to mark a tool, and `filterAdmin()` to strip marked tools from a set.

## The marker

```ts
const ADMIN_MARKER = Symbol("admin");

export function admin<T>(t: T): T {
  (t as Record<symbol, boolean>)[ADMIN_MARKER] = true;
  return t;
}
```

The marker is a hidden symbol, so it doesn't interfere with the AI SDK's own metadata on the tool object. `admin()` mutates the tool in place and returns it, so you can wrap it at the export site:

```ts
import { admin } from "@/lib/ai/skills/admin";
import { tool } from "ai";
import { z } from "zod";

export const dangerous_tool = admin(
  tool({
    description: "...",
    inputSchema: z.object({
      /* ... */
    }),
    execute: async (input) => {
      /* ... */
    },
  }),
);
```

## filterAdmin

```ts
export function filterAdmin(tools: ToolSet): ToolSet {
  const filtered: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    if (!(t as Record<symbol, boolean>)[ADMIN_MARKER]) {
      filtered[name] = t;
    }
  }
  return filtered;
}
```

It walks the set and returns a new object containing every tool that is **not** admin-marked. Subagents call `filterAdmin` against their domain's full toolset before passing it to the agent when the caller's role isn't `admin`:

```ts
const allTools: ToolSet = { ...spec.tools, loadSkill };
const tools = role === UserRole.Admin ? allTools : filterAdmin(allTools);
```

Non-admins literally never see the tool — the AI SDK never even renders its description, so the model doesn't know it exists.

## Stacking with minRole

This gate is in addition to `minRole` on the skill itself:

- `minRole` gates **entire skills** (their description, criteria, and all the tools they unlock).
- `admin()` gates **individual tools** inside a skill.

Both apply independently. A skill might be visible to organizers but contain individual admin-only tools — organizers get the skill and most of its tools; admins additionally get the admin-marked ones.

## What's not admin-gated

The orchestrator's base tools (`currentTime`, `documentation`, `scheduleTask`, `listScheduledTasks`, `cancelTask`, `delegate_*`) are **not** run through `filterAdmin`. If you want a base tool to be admin-gated, you need to conditionally add it to the `tools` object in `createOrchestrator` based on `context.role`, or move it into a delegate domain where `filterAdmin` does apply.
