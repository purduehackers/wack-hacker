export const ORGANIZER_PLATFORMS = [
  "discord",
  "linear",
  "notion",
  "sentry",
  "github",
  "figma",
] as const;

export const EDITABLE_PLATFORMS = ["linear", "notion", "sentry", "github", "figma"] as const;

/**
 * Per-user key prefix in Edge Config. Storing each organizer under its own
 * key (e.g. `organizer:1234567890`) lets `upsertOrganizer` do an atomic
 * per-user read-modify-write via the Edge Config patch API without racing
 * concurrent updates for other users.
 */
export const ORGANIZER_KEY_PREFIX = "organizer:";
