import { env } from "../../../../env.ts";

const BASE_URL = "https://hcb.hackclub.com/api/v3";
const REQUEST_TIMEOUT_MS = 15_000;

/** Resolve pagination input to a query-string object with defaults. */
export function paginationQuery(input: { per_page?: number; page?: number }): {
  per_page: number;
  page: number;
} {
  return { per_page: input.per_page ?? 50, page: input.page ?? 1 };
}

export function hcbOrgSlug(): string {
  return env.HCB_ORG_SLUG;
}

/** Build a link to the HCB web UI for a transaction id. */
export function hcbTxnUrl(id: string): string {
  return `https://hcb.hackclub.com/hcb/${id}`;
}

function primitiveString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** GET against the HCB v3 public API. Read-only; no auth required (Transparency Mode). */
export async function hcbGet<T = unknown>(
  path: string,
  query?: Record<string, unknown>,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, primitiveString(v));
      } else {
        url.searchParams.set(key, primitiveString(value));
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
  return response.json() as Promise<T>;
}

/** Paginate through a list endpoint until an empty page or the cap is reached. */
export async function hcbPaginate<T>(
  path: string,
  query: Record<string, unknown> = {},
  {
    maxItems = 500,
    maxPages = 10,
    perPage = 100,
  }: {
    maxItems?: number;
    maxPages?: number;
    perPage?: number;
  } = {},
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await hcbGet<T[]>(path, { ...query, page, per_page: perPage });
    if (!Array.isArray(batch) || batch.length === 0) break;
    results.push(...batch);
    if (results.length >= maxItems) return results.slice(0, maxItems);
    if (batch.length < perPage) break;
  }
  return results;
}
