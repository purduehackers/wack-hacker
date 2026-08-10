import { z } from "zod";

/**
 * Shared field schemas for Vercel tool inputs.
 *
 * Vercel reuses a handful of query-parameter shapes across almost every
 * paginated endpoint. Declaring them once keeps the integer/format decisions in
 * a single reviewable place instead of re-deriving them at ~40 call sites.
 */

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
