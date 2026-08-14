/**
 * @fileoverview Fixed identifiers, shared input fields, and redaction helpers
 * for this domain.
 *
 * Vercel reuses a handful of query-parameter shapes across almost every
 * paginated endpoint, and three products return secrets inline. Declaring both
 * once keeps the integer/format decisions and the "never surface this field"
 * decisions in a single reviewable place instead of re-deriving them at ~40
 * call sites.
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

/**
 * Any non-array object payload. The branch above the check handles arrays, so
 * `looseObject` is exactly the "walkable record" case. It keeps every key,
 * which is the point: the walk only removes the one named key.
 */
const objectPayload = z.looseObject({});

/**
 * Recursively drop every property named `key` from an SDK payload, walking
 * arrays and plain objects. Dropping (rather than masking) keeps the secret out
 * of the serialized tool output entirely.
 */
function dropKeyDeep(input: unknown, key: string): unknown {
  if (Array.isArray(input)) return input.map((item) => dropKeyDeep(item, key));
  const asObject = objectPayload.safeParse(input);
  if (asObject.success) {
    return Object.fromEntries(
      Object.entries(asObject.data)
        .filter(([entryKey]) => entryKey !== key)
        .map(([entryKey, entryValue]) => [entryKey, dropKeyDeep(entryValue, key)] as const),
    );
  }
  return input;
}

/**
 * Vercel renamed Edge Config to Global Config, but `@vercel/sdk` 1.19.40 still
 * exposes the accessor as `edgeConfig` with `*EdgeConfig*` method and parameter
 * names. Those are upstream identifiers, so they stay as they are. Every name
 * this domain owns — tools, inputs, descriptions — uses the current product
 * name.
 *
 * Strip the secret `token` field from Global Config token payloads. The Vercel
 * SDK returns raw tokens on list/get/create. Surfacing those into Discord or
 * logs would leak credentials. The SDK explicitly documents the `id` field as
 * a non-secret reference, so it stays along with label/createdAt.
 */
export function redactTokens(input: unknown): unknown {
  return dropKeyDeep(input, "token");
}

/** Strip `value` from env var payloads. The Vercel SDK may return plaintext for `plain` scope. */
export function redactEnvValues(input: unknown): unknown {
  return dropKeyDeep(input, "value");
}
