# Approvals

Approval prompts gate individual tool calls behind a Discord button prompt. A gated tool cannot run until someone clicks **Approve**; if they click **Deny** or ignore the prompt for too long, the tool returns a short diagnostic instead of executing.

Whether a tool is gated — and who may click — is decided by the [access policy](policy.md): a tool's `access: { risk, confirm?, … }` spec resolves to a confirm mode of `"none"`, `"self"`, or `"second-party"`. Destructive tools default to `"self"`. The Discord flow itself lives in `src/lib/ai/approvals/`:

| File         | What it is                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `index.ts`   | Public API — `wrapToolWithApproval`, the legacy `approval()` marker, re-exports.                          |
| `runtime.ts` | `wrapToolWithApproval(tool, name, policy, opts)` — wraps one tool with the prompt + wait + execute flow.  |
| `store.ts`   | `ApprovalStore` — Redis-backed state for a pending approval (create, get, decide, `waitFor`).             |
| `helpers.ts` | `buildApprovalEmbed`, `buildApprovalComponents`, `buildDecisionEmbed`, `formatToolCall` — the Discord UI. |
| `types.ts`   | `ApprovalPolicy`, `ApprovalState`, `WrapApprovalOptions`.                                                 |

## Gating a tool

Declare it in the tool's access descriptor — there is no separate wrapper to apply:

```ts
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/_shared/define-tool";

export const wipe_channel = defineTool({
  name: "wipe_channel",
  domain: "discord",
  description: "Delete every message in the current channel.",
  access: { risk: "destructive", reason: "Wiping a channel deletes history permanently." },
  input: z.object({
    channel_id: z.string(),
  }),
  execute: async ({ channel_id }) => {
    // ...
  },
});
```

`risk: "destructive"` defaults to `confirm: "self"`, so this tool prompts before every run. A write tool that should also prompt declares `confirm: "self"` explicitly; org-level destructive actions declare `confirm: "second-party"`. The optional `reason` becomes the fallback justification shown to the user when the agent doesn't supply one via `_reason`.

`applyPolicy` (the enforcement choke point in both the orchestrator and subagents) calls `wrapToolWithApproval` for every tool whose resolved confirm mode is not `"none"`. The legacy `approval()` marker from before the policy layer still resolves to a self-confirmed write, but no tool uses it anymore — declare the `access` field in `defineTool` instead.

## What the agent sees

The approval wrapper (driven by `applyPolicy`) rewrites a gated tool's `inputSchema` to add an injected `_reason: string` field (optional when a static `reason` was set, required otherwise). The description gets a short appended `[approval]` marker — the approval protocol itself is stated once in the agent preambles (`SYSTEM_PROMPT` / `SUBAGENT_PREAMBLE`) rather than repeated on every wrapped tool, which keeps tool descriptions from each re-billing a paragraph of boilerplate per step. The rest of the tool's schema is preserved verbatim — the agent sees its original arguments plus `_reason`.

If the gated tool's original `inputSchema` is not a `ZodObject`, the wrapper throws at wrap time (not runtime). The constraint exists because `_reason` has to live on a plain object shape for the wrapper to be able to extract it.

## What the user sees

When the agent calls a gated tool, the wrapper:

1. Creates an `ApprovalState` in Redis (pending, keyed by a UUID, TTL = timeout + 60s buffer) carrying the resolved `confirmMode`, and appends a durable `requested` row to the [audit log](policy.md#audit-log).
2. Posts an amber embed to the channel (or thread, if the conversation is in one) pinging the requester. The embed renders the call as a python-style signature: `delegate_<domain>.<tool>(k=v, …)` with `_reason` stripped, plus a "Reason" field showing the agent's justification. The footer states who may decide.
3. Attaches two buttons — ✅ Approve and ❌ Deny — each with a `custom_id` of `tool-approval:<action>:<approvalId>`.
4. Calls `store.waitFor(approvalId, { timeoutMs, signal })` to block the tool's execution until a decision is recorded.

When someone clicks a button, the Discord component handler at `src/bot/components/tool-approval.ts` authorizes the click (`clickerRejection`) and calls `store.decide(approvalId, "approved" | "denied", decidedByUserId)`. The wrapper's poll loop picks up the new state, appends the decision to the audit log, and either runs the original `execute` (yielding its output back into the agent's message stream) or yields a denial message without running it.

If nobody decides within the timeout, the wrapper marks the state as `"timeout"` and the Discord message is swapped for a grey "auto-expired" embed. The default timeout is 240 seconds.

## Who may click

| Confirm mode     | Who decides                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `"self"`         | Only the requester. A guard against model misfires, not a control on the human.               |
| `"second-party"` | Any **organizer or admin other than the requester**. The requester's own clicks are rejected. |

Second-party mode is reserved for a small set of org-level destructive tools (member bans/kicks, repo/project deletion, bulk sends) — approval fatigue trains people to rubber-stamp, so the set widens by data, not by default. Legacy approval rows written before `confirmMode` existed are treated as `"self"`.

## Audit trail

Redis keeps only the live state (it expires minutes after the decision). The durable history — requested, approved/denied/timeout, and executed/failed for destructive runs — is appended to the Turso `action_audit` table and readable via the admin-only `list_audit_log` tool. See [Access policy](policy.md).
