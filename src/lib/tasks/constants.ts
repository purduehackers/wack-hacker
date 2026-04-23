/**
 * Default IANA timezone applied wherever scheduling intent needs a zone but
 * the caller hasn't named one — the prompt's `{{USER_TZ}}`, the cron parser,
 * the schedule-tool formatting, and the scheduled-task-fire handler's
 * synthetic `AgentContext`. Kept single-sourced so a future change to the
 * community default (e.g. a guild-level preference) touches one line.
 */
export const DEFAULT_TIMEZONE = "America/New_York";
