/**
 * Column enumerations for the Turso schema.
 *
 * These live in `db/` rather than beside the policy logic that consumes them
 * because they are part of the *storage contract*: persisted rows carry these
 * exact strings. The agent's policy modules import them from here so a value
 * can never drift away from what is written.
 *
 * All are `as const` objects rather than TS `enum`s, which `erasableSyntaxOnly`
 * forbids because an enum emits runtime code.
 */

/** What a tool does to the world. Drives the role and confirmation defaults. */
export const RiskLevel = {
  /** Pure retrieval. */
  Read: "read",
  /** Recoverable, team-internal mutation. */
  Write: "write",
  /** Irreversible, externally visible, or touching money, people, privileges. */
  Destructive: "destructive",
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/** Who must sign off before a gated tool runs. */
export const ConfirmMode = {
  None: "none",
  /** The requester approves their own call. */
  Self: "self",
  /** Someone *other than* the requester must approve. */
  SecondParty: "second-party",
} as const;

export type ConfirmMode = (typeof ConfirmMode)[keyof typeof ConfirmMode];

/** Where a turn originated. Scheduled fires carry re-resolved roles. */
export const PolicySource = {
  Chat: "chat",
  Scheduled: "scheduled",
} as const;

export type PolicySource = (typeof PolicySource)[keyof typeof PolicySource];

/** Lifecycle stages recorded in the durable audit log. */
export const AuditDecision = {
  Requested: "requested",
  Approved: "approved",
  Denied: "denied",
  Timeout: "timeout",
  Executed: "executed",
  /** The tool ran and threw. */
  Failed: "failed",
  /**
   * The approval prompt could not be delivered, so the tool never ran. Kept
   * distinct from `Failed` so the audit trail does not imply an attempt.
   */
  PromptFailed: "prompt_failed",
} as const;

export type AuditDecision = (typeof AuditDecision)[keyof typeof AuditDecision];

export const ScheduleType = {
  Once: "once",
  Recurring: "recurring",
} as const;

export type ScheduleType = (typeof ScheduleType)[keyof typeof ScheduleType];

export const ScheduledTaskStatus = {
  Active: "active",
  Cancelled: "cancelled",
  Completed: "completed",
  /** Terminal failure. Never used for a fire whose outcome is unknown. */
  Failed: "failed",
} as const;

export type ScheduledTaskStatus = (typeof ScheduledTaskStatus)[keyof typeof ScheduledTaskStatus];
/** How a durable schedule is materialized at fire time. */
export const ScheduleActionType = {
  /** Run a fresh Eve turn with current Discord authority. */
  Agent: "agent",
  /** Ask the bot to post the stored content verbatim without a model call. */
  Message: "message",
} as const;

export type ScheduleActionType = (typeof ScheduleActionType)[keyof typeof ScheduleActionType];
