/**
 * @fileoverview Fixed identifiers and shared input fields for this domain.
 *
 * Vercel reuses a handful of query-parameter shapes across almost every
 * paginated endpoint. Declaring each once keeps the integer/format decisions
 * in a single reviewable place instead of re-deriving them at ~40 call sites.
 * The redaction helpers for payloads that carry secrets inline live in
 * `./redaction.ts`.
 */

import { z } from "zod";

import { env as runtimeEnv } from "../../../env.ts";

/**
 * Typed SDK configuration. The domain runtime denies execution before any call
 * can reach this empty fallback.
 */
export const env = { VERCEL_API_TOKEN: runtimeEnv.VERCEL_API_TOKEN ?? "" };

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

/**
 * Unix timestamp in milliseconds — the SDK's `since` / `until` / `from` / `to`
 * cursors and windows are all documented as "Unix time in milliseconds".
 */
export const epochMillis = z.int().min(0);

/** Page size. Every paginated Vercel endpoint rejects a non-positive `limit`. */
export const pageLimit = z.int().min(1);

/**
 * Timestamps a few endpoints take as ISO 8601 strings instead of epoch millis.
 * `offset: true` keeps `+05:00` forms acceptable alongside the `Z` form the API
 * documents, so this only rejects values that were never valid ISO 8601.
 */
export const isoTimestamp = z.iso.datetime({ offset: true });

/**
 * Query parameters the SDK types as a decimal string rather than a number
 * (the DNS and registrar endpoints). The value still has to be a number.
 */
export const numericString = z.string().regex(z.regexes.integer);

/** The environments a caller can scope a project environment variable to. */
export const ENV_TARGETS = ["production", "preview", "development"] as const;

/** How Vercel stores an environment variable's value. */
export const ENV_TYPES = ["system", "encrypted", "plain", "sensitive"] as const;
