/**
 * Stable identities for the simulator's virtual server. Digit-only strings so
 * they render correctly inside Discord mentions (`<@id>` / `<#id>`), and below
 * `Number.MAX_SAFE_INTEGER` so id minting can do plain arithmetic.
 */
export const SIM_GUILD_ID = "920000000000000001";
export const SIM_BOT_ID = "920000000000000002";
export const SIM_USER_ID = "920000000000000010";

/** Default second-party reviewer used when the UI doesn't specify a clicker. */
export const SIM_REVIEWER_ID = "920000000000000011";

/** Mirrors the workflow default (`AgentContext`); pinned for prompt stability. */
export const SIM_DEFAULT_TIMEZONE = "America/New_York";

/** Default channel a fresh simulator session opens in. */
export const SIM_DEFAULT_CHANNEL = "general";
