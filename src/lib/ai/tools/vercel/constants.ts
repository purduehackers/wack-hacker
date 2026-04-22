/**
 * Fixed identifiers for the Purdue Hackers Vercel team. These are not secrets
 * (they appear in dashboard URLs) and never rotate, so they live here rather
 * than in env — same rationale as the Notion data-source UUIDs in
 * `tools/sales/constants.ts`.
 *
 * To discover these values, call `whoami` + `list_teams` with a valid
 * `VERCEL_API_TOKEN`, or look at the Vercel dashboard URL.
 */
export const VERCEL_TEAM_ID = "team_REPLACE_ME";
export const VERCEL_TEAM_SLUG = "purduehackers";

/** Dashboard URL prefix used for building links in tool responses. */
export const VERCEL_DASHBOARD_BASE = `https://vercel.com/${VERCEL_TEAM_SLUG}`;
