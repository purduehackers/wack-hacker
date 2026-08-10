import { z } from "zod";

export const perPageField = z.int().min(1).max(100).optional().describe("Page size (default 50)");

/**
 * Sentry surfaces issue, rule, and alert identifiers as decimal digit strings,
 * and several call sites hand them straight to `Number(...)`. Naming the format
 * keeps that assumption enforced at the tool boundary instead of letting `NaN`
 * reach the API.
 */
export const sentryNumericId = z.stringFormat("sentry-numeric-id", /^\d+$/u);
