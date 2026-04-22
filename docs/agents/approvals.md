# Approvals

`approval()` is a marker that gates individual tool calls behind a Discord button prompt. A wrapped tool cannot run until the requesting user clicks **Approve**; if they click **Deny** or ignore the prompt for too long, the tool returns a short diagnostic instead of executing.

The feature lives entirely in `src/lib/ai/approvals/`:

| File         | What it is                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `index.ts`   | The public API — `approval()` marker, `getApprovalOptions`, `hasApprovalMarker`, re-exports.               |
| `runtime.ts` | `wrapApprovalTools(tools, opts)` — walks a `ToolSet`, replaces any marked tool with an approval-gated one. |
| `store.ts`   | `ApprovalStore` — Redis-backed state for a pending approval (create, get, decide, `waitFor`).              |
| `helpers.ts` | `buildApprovalEmbed`, `buildApprovalComponents`, `buildDecisionEmbed`, `formatToolCall` — the Discord UI.  |
| `types.ts`   | `ApprovalOptions`, `ApprovalState`, `WrapApprovalOptions`.                                                 |

## Marking a tool

```ts
import { approval } from "@/lib/ai/approvals";
import { tool } from "ai";
import { z } from "zod";

export const wipe_channel = approval(
  tool({
    description: "Delete every message in the current channel.",
    inputSchema: z.object({
      channel_id: z.string(),
    }),
    execute: async ({ channel_id }) => {
      // ...
    },
  }),
  { reason: "Wiping a channel deletes history permanently." },
);
```

`approval(tool, opts?)` mutates the tool in place and returns it. The marker is a hidden `Symbol`, so it doesn't interfere with the AI SDK's metadata. The optional `reason` becomes the fallback justification shown to the user when the agent doesn't supply one via `_reason`.

## What the agent sees

`wrapApprovalTools` rewrites a marked tool's `inputSchema` to add an injected `_reason: string` field. The description gets an appended note that explains `_reason` is required (or optional, if a static `reason` was set). The rest of the tool's schema is preserved verbatim — the agent sees its original arguments plus `_reason`.

If the wrapped tool's original `inputSchema` is not a `ZodObject`, `wrapApprovalTools` throws at wrap time (not runtime). The constraint exists because `_reason` has to live on a plain object shape for the wrapper to be able to extract it.

## What the user sees

When the agent calls a wrapped tool, the wrapper:

1. Creates an `ApprovalState` in Redis (pending, keyed by a UUID, TTL = timeout + 60s buffer).
2. Posts an amber embed to the channel (or thread, if the conversation is in one) pinging the requester. The embed renders the call as a python-style signature: `delegate_<domain>.<tool>(k=v, …)` with `_reason` stripped, plus a "Reason" field showing the agent's justification.
3. Attaches two buttons — ✅ Approve and ❌ Deny — each with a `custom_id` of `tool-approval:<action>:<approvalId>`.
4. Calls `store.waitFor(approvalId, { timeoutMs, signal })` to block the tool's execution until a decision is recorded.

Only the requester can approve. When they click a button, the Discord component handler at `src/bot/components/tool-approval.ts` calls `store.decide(approvalId, "approved" | "denied", decidedByUserId)`. The wrapper's poll loop picks up the new state and either runs the original `execute` (yielding its output back into the agent's message stream) or yields a denial message without running it.

If nobody decides within the timeout, the wrapper marks the state as `"timeout"` and the Discord message is swapped for a grey "auto-expired" embed. The default timeout is 240 seconds.

## Wiring it in

Subagent wiring happens inside `createDelegationTool` — after `filterAdmin` strips admin-only tools for non-admin callers, `wrapApprovalTools(tools, { context, delegateName })` replaces any marked tool with its approval-gated version. The `delegateName` is how the prompt renders `delegate_<domain>.<tool>(...)`.

Orchestrator base tools are wrapped the same way but without a `delegateName`, so the prompt renders just `<tool>(...)`. Today the only orchestrator-level approvals are `schedule_task` and `cancel_task` (see [Workflows § scheduled tasks](../workflows/scheduling.md)), both in `src/lib/ai/tools/schedule/index.ts`:

```ts
export const schedule_task = approval(
  tool({
    description: "Schedule a one-time or recurring task…",
    // …
  }),
);

export const cancel_task = approval(
  tool({
    description: "Cancel a previously scheduled task…",
    // …
  }),
);
```

Neither needs a static `reason` because both take a natural-language `description` from the agent anyway.

## Stacking with other markers

- `admin()` — hides a tool entirely from non-admin roles. Applied in `filterAdmin(tools)` before `wrapApprovalTools`, so an admin-marked tool that's also approval-marked will simply not be visible to an organizer.
- `minRole` on a skill — gates the entire skill (and all its tools) behind a role; orthogonal to `approval()`.

Approvals are about **per-call consent**, not access control. Use `admin()` when a tool should never be reachable by an organizer; use `approval()` when they _can_ reach it but should pause to confirm each use.
