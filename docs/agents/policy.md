# Access policy

`src/lib/ai/policy/` is the single permissions primitive. Every tool declares what it does via `access()`; one pure function (`decide()`) turns that declaration plus the caller's role into a decision; one choke point (`applyPolicy()`) enforces it on every ToolSet handed to a model. It replaces the old pair of independent markers — `admin()` (deleted) and `approval()` (legacy, still honored, no longer used).

| File           | What it is                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `access.ts`    | `access(spec, tool)` symbol marker, `getAccessSpec`, `resolveAccessSpec` (legacy fallback).     |
| `decide.ts`    | `decide(subject, tool, ctx)` — the pure decision point, plus the role×risk defaults table.      |
| `apply.ts`     | `applyPolicy(tools, opts)` — enforcement on a ToolSet.                                          |
| `audit.ts`     | `AuditLog` — durable append-only writer for the Turso `action_audit` table.                     |
| `budget.ts`    | `BudgetStore` + `readBudgetState`/`recordTurnTokens` — the daily token budget dimension.        |
| `constants.ts` | `RiskLevel`, `ConfirmMode`, `PolicySource`, `AuditDecision` (as-const enums), budget constants. |
| `types.ts`     | `AccessSpec`, `PolicyDecision`, `ActionAuditEntry`, `ApplyPolicyOptions`, …                     |

## Declaring access

Every exported tool in `src/lib/ai/tools/**` wraps its definition:

```ts
import { access } from "@/lib/ai/policy";
import { tool } from "ai";

export const delete_project = access(
  { risk: "destructive" },
  tool({
    /* ... */
  }),
);
```

`AccessSpec` fields:

| Field     | Required | Meaning                                                                                                                                                                       |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `risk`    | yes      | `"read"` (pure retrieval), `"write"` (recoverable, team-internal mutation), `"destructive"` (irreversible, externally visible, production-affecting, money/people/privilege). |
| `minRole` | no       | Minimum role that may _see_ the tool. Defaults by risk (below).                                                                                                               |
| `confirm` | no       | `"none"`, `"self"`, or `"second-party"`. Defaults by risk (below).                                                                                                            |
| `reason`  | no       | Static justification shown in the approval prompt when the agent omits `_reason`.                                                                                             |

The role×risk defaults live in one static table in `decide.ts` — per-domain or per-channel overrides should become data in that table, not new wrapper code:

| Risk          | Default `minRole` | Default `confirm` |
| ------------- | ----------------- | ----------------- |
| `read`        | `public`          | `none`            |
| `write`       | `organizer`       | `none`            |
| `destructive` | `organizer`       | `self`            |

Enforcement is by declaration, not naming: `src/lib/ai/tools/access-coverage.test.ts` imports every tool module and fails listing any export without a declared risk. The old destructive-name regex survives only as a secondary lint (a `delete_*` tool may not claim `risk: "read"`).

## decide()

```ts
decide(
  subject: { userId, role },
  tool: { name, domain?, access },
  ctx: { channelId, source: "chat" | "scheduled", budgetState },
) → { kind: "allow" }
  | { kind: "deny", code: "role" | "budget", message }
  | { kind: "confirm" }
  | { kind: "approve", approvers: "second-party" }
```

Pure and serializable on both ends — if the org ever outgrows a static table, these rules can compile to Cedar/OpenFGA without changing call sites. Budget denials apply only to `public` subjects; organizers and admins are exempt.

## applyPolicy()

Both choke points — `getOrchestratorTools` and `createDelegationTool` — run their full ToolSet through `applyPolicy(tools, { context, delegateName?, budget? })`, which maps each decision onto the set:

- **deny (role)** → the tool is omitted entirely. Deny-by-absence: the model never sees tools above the caller's role, so it can't waste context retrying them.
- **deny (budget)** → the tool stays visible but its `execute` is replaced with a friendly limit message the model can relay.
- **confirm / approve** → wrapped with the Discord [approval flow](approvals.md) in the resolved mode.
- **allow** → passed through untouched, except destructive tools, which gain an execute wrapper that appends `executed`/`failed` audit rows.

This applies to orchestrator base tools too — there is no longer an unfiltered base ToolSet. Admin-gating a base tool is just `minRole: "admin"` in its descriptor (e.g. `list_audit_log`).

## Audit log

Redis approval state expires minutes after a decision; history is durable. `AuditLog.record()` appends to the Turso `action_audit` table: `{at, userId, role, source, delegate, tool, risk, inputHash, inputPreview, reason, decision, decidedBy, traceId}` with `decision ∈ requested | approved | denied | timeout | executed | failed`. Rows are written by the approval runtime (request + decision) and by the destructive-execution wrappers. The writer never throws — an audit outage must not block the action it describes — but failures are counted (`policy.audit_write_failed`) and logged.

Admins can query it in Discord via the `list_audit_log` base tool ("who deleted X?").

## Budgets

`recordTurnTokens` folds every finished turn's token total into a per-user daily Redis counter (`budget:tokens:<utc-day>:<userId>`); `readBudgetState` resolves the dimension once per turn (and per delegation) and `decide()` denies non-organizers past `PUBLIC_DAILY_TOKEN_LIMIT`. Everything fails open: a Redis outage (or unconfigured Upstash env) degrades to "no budget enforcement", never a locked-out bot.

## Scheduled tasks

Scheduled fires re-resolve the creator's _current_ Discord roles before building the agent context — a de-roled user does not keep organizer-powered recurring runs. The stored role snapshot is only a fallback for Discord outages, downgrades post a channel notice, and the resolution path lands in the audit log. Contexts carry `source: "scheduled"` so policy and audit can distinguish them from interactive chat. See [Workflows § scheduled tasks](../workflows/scheduling.md).
