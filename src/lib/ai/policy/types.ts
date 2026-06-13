import type { ApprovalStoreLike } from "../approvals/types.ts";
import type { UserRole } from "../constants.ts";
import type { AgentContext } from "../context.ts";
import type { AuditDecision, ConfirmMode, PolicySource, RiskLevel } from "./constants.ts";

export type { AuditDecision, ConfirmMode, PolicySource, RiskLevel } from "./constants.ts";

/**
 * Declarative access descriptor attached to a tool via `access()`. The single
 * permissions primitive: replaces the `admin()` marker (`minRole: "admin"`)
 * and the `approval()` wrapper (`confirm` + `reason`).
 */
export interface AccessSpec {
  /** Risk class of the tool's effect. Required on every tool. */
  risk: RiskLevel;
  /**
   * Minimum role that may see and run the tool. Defaults by risk via the
   * role×risk table in `decide()`: read→public, write/destructive→organizer.
   */
  minRole?: UserRole;
  /**
   * Confirmation requirement. Defaults by risk: read/write→none,
   * destructive→self. `second-party` requires another organizer to approve.
   */
  confirm?: ConfirmMode;
  /** Static approval reason shown when the agent omits `_reason`. */
  reason?: string;
}

/** Who is asking. */
export interface PolicySubject {
  userId: string;
  role: UserRole;
}

/** What they are asking to run. */
export interface PolicyToolRef {
  name: string;
  domain?: string;
  access: AccessSpec;
}

/**
 * Daily token budget snapshot for a subject. `null`/absent means unknown —
 * the budget dimension is skipped rather than failing closed.
 */
export interface BudgetState {
  used: number;
  limit: number;
}

/** Call-site context for a policy decision. All fields serializable. */
export interface PolicyEvalContext {
  channelId: string;
  source: PolicySource;
  budgetState?: BudgetState | null;
}

/**
 * Outcome of `decide()`. Serializable so rules could later compile to an
 * external policy engine without changing call sites.
 */
export type PolicyDecision =
  | { kind: "allow" }
  | { kind: "deny"; code: "role" | "budget"; message: string }
  | { kind: "confirm" }
  | { kind: "approve"; approvers: "second-party" };

/** One append-only audit event. Input is hashed + previewed by the writer. */
export interface ActionAuditEntry {
  userId: string;
  role: UserRole;
  source: PolicySource;
  delegate?: string;
  tool: string;
  risk: RiskLevel;
  input: unknown;
  reason?: string;
  decision: AuditDecision;
  decidedBy?: string;
  traceId?: string;
}

/**
 * Minimal audit surface so the approval runtime and `applyPolicy` can record
 * events without importing the concrete Turso-backed writer (tests inject a
 * fake; the runtime stays free of policy imports at runtime).
 */
export interface AuditLogLike {
  record(entry: ActionAuditEntry): Promise<void>;
}

/** Options for `applyPolicy()` — the single enforcement choke point. */
export interface ApplyPolicyOptions {
  context: AgentContext;
  /** Subagent domain name (e.g. "github"). Omit at the orchestrator layer. */
  delegateName?: string;
  /** Resolved budget state for the subject; null/absent skips the dimension. */
  budget?: BudgetState | null;
  timeoutMs?: number;
  /** Test injection points. Production callers omit both. */
  store?: ApprovalStoreLike;
  audit?: AuditLogLike;
}
