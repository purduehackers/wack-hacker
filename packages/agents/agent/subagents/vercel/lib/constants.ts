/**
 * Fixed identifiers for the Purdue Hackers Vercel team. These are not secrets
 * (they appear in dashboard URLs) and never rotate, so they live here rather
 * than in env — same rationale as the Notion data-source UUIDs in
 * `../../outreach/lib/constants.ts`.
 *
 * To discover these values, call `whoami` + `list_teams` with a valid
 * `VERCEL_API_TOKEN`, or look at the Vercel dashboard URL.
 */
export const VERCEL_TEAM_ID = "team_kOQWJUQYzGW4blWthdK71Y8A";
export const VERCEL_TEAM_SLUG = "purduehackers";

/** Team scope spread into every team-scoped Vercel SDK call. */
export const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;
