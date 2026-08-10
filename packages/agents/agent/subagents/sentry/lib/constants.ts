import { z } from "zod";

import { env as runtimeEnv } from "../../../env.ts";

/**
 * Input fields, response projections, and SDK configuration shared across this
 * domain's tools.
 */

/** Typed SDK configuration; execution is denied before these fallbacks can be used. */
export const env = {
  SENTRY_AUTH_TOKEN: runtimeEnv.SENTRY_AUTH_TOKEN ?? "",
  SENTRY_ORG: runtimeEnv.SENTRY_ORG ?? "",
};

export const perPageField = z.int().min(1).max(100).optional().describe("Page size (default 50)");

/**
 * Sentry surfaces issue, rule, and alert identifiers as decimal digit strings,
 * and several call sites hand them straight to `Number(...)`. Naming the format
 * keeps that assumption enforced at the tool boundary instead of letting `NaN`
 * reach the API.
 */
export const sentryNumericId = z.stringFormat("sentry-numeric-id", /^\d+$/u);

/**
 * Read-only projection over organization-member fields the generated SDK type
 * omits: an unexpected shape must degrade to "absent" rather than fail the tool.
 */
export const memberProjectionSchema = z.looseObject({
  role: z.string().nullish().catch(undefined),
  roleName: z.string().nullish().catch(undefined),
  teams: z.array(z.json()).nullish().catch(undefined),
});
