/**
 * Policy enums are `as const` objects instead of TypeScript enums for the
 * same reason as `UserRole` in `../constants.ts`: this module is reachable
 * from workflow step bundles, which Node.js executes in strip-only type mode
 * — and strip-only mode does not support enum syntax. The derived type
 * aliases live here so consumers import the value and type under one name.
 */

/** Risk class a tool must declare via `access()`. There is no default. */
export const RiskLevel = {
  Read: "read",
  Write: "write",
  Destructive: "destructive",
} as const;

// eslint-disable-next-line @factory/constants-file-organization, @factory/types-file-organization
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/** Confirmation requirement for a tool call. */
export const ConfirmMode = {
  None: "none",
  Self: "self",
  SecondParty: "second-party",
} as const;

// eslint-disable-next-line @factory/constants-file-organization, @factory/types-file-organization
export type ConfirmMode = (typeof ConfirmMode)[keyof typeof ConfirmMode];

/** Where a turn originated. Scheduled fires carry re-resolved roles. */
export const PolicySource = {
  Chat: "chat",
  Scheduled: "scheduled",
} as const;

// eslint-disable-next-line @factory/constants-file-organization, @factory/types-file-organization
export type PolicySource = (typeof PolicySource)[keyof typeof PolicySource];

/** Lifecycle stages recorded in the durable audit log. */
export const AuditDecision = {
  Requested: "requested",
  Approved: "approved",
  Denied: "denied",
  Timeout: "timeout",
  Executed: "executed",
  Failed: "failed",
} as const;

// eslint-disable-next-line @factory/constants-file-organization, @factory/types-file-organization
export type AuditDecision = (typeof AuditDecision)[keyof typeof AuditDecision];

/**
 * v1 budget: one constant for non-organizer users. The point is establishing
 * budget as a policy dimension — tuning the number (or making it per-role
 * data) comes later.
 */
export const PUBLIC_DAILY_TOKEN_LIMIT = 250_000;

export const BUDGET_DENY_MESSAGE =
  "Daily AI usage limit reached for this account. The limit resets at midnight UTC — " +
  "ask an organizer if you need something sooner.";
