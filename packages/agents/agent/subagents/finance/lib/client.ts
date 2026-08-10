import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../../env.ts";
import { stringifyQueryValue } from "../../../lib/http/query.ts";
import { paginationInputSchema } from "./constants.ts";

const BASE_URL = "https://hcb.hackclub.com/api/v3";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A single value an HCB query parameter can carry before serialization.
 * Deliberately excludes `Date`: the shared `stringifyQueryValue` sends objects
 * through `JSON.stringify`, so a Date would serialize as a *quoted* ISO string
 * (`?since=%222024-01-02T03%3A04%3A05.000Z%22`) rather than a bare date.
 */
type HcbQueryScalar = string | number | boolean;
/** Query bag accepted by the HCB helpers: scalars, repeated scalars, or absent. */
type HcbQuery = Readonly<Record<string, HcbQueryScalar | HcbQueryScalar[] | null | undefined>>;

/** Resolve pagination input to a query-string object with defaults. */
export function paginationQuery(input: z.input<typeof paginationInputSchema>): {
  per_page: number;
  page: number;
} {
  return { per_page: input.per_page ?? 50, page: input.page ?? 1 };
}

export function hcbOrgSlug(): string {
  return env.HCB_ORG_SLUG ?? "";
}

/** Build a link to the HCB web UI for a transaction id. */
export function hcbTxnUrl(id: string): string {
  return `https://hcb.hackclub.com/hcb/${id}`;
}

/** GET against the HCB v3 public API. Read-only; no auth required (Transparency Mode). */
export async function hcbGet<S extends z.ZodType>(
  path: string,
  query: HcbQuery | undefined,
  schema: S,
): Promise<z.output<S>> {
  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, stringifyQueryValue(v));
      } else {
        url.searchParams.set(key, stringifyQueryValue(value));
      }
    }
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`HCB API 404: ${url.pathname} — check the org slug or resource id.`);
    }
    if (response.status === 429) {
      throw new Error("HCB API rate limited. Try again in a moment.");
    }
    const body = await response.text().catch(() => "");
    throw new Error(`HCB API ${response.status}: ${body.slice(0, 200)}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UpstreamError({
      service: "HCB",
      status: 502,
      detail: `invalid response: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}

/** Paginate through a list endpoint until an empty page or the cap is reached. */
export async function hcbPaginate<S extends z.ZodType>(
  path: string,
  query: HcbQuery,
  {
    maxItems = 500,
    maxPages = 10,
    perPage = 100,
  }: {
    maxItems?: number;
    maxPages?: number;
    perPage?: number;
  },
  schema: S,
): Promise<z.output<S>[]> {
  const results: z.output<S>[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await hcbGet(path, { ...query, page, per_page: perPage }, z.array(schema));
    if (batch.length === 0) break;
    results.push(...batch);
    if (results.length >= maxItems) return results.slice(0, maxItems);
    if (batch.length < perPage) break;
  }
  return results;
}
