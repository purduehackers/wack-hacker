import { env } from "../../../../env.ts";

const BASE_URL = "https://sentry.io/api/0";

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

interface PaginatedResult<T> {
  results: T[];
  nextCursor?: string;
}

/** Parse Sentry's `Link` header to extract the next cursor. */
function parseNextCursor(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  const match = linkHeader.match(/<[^>]+\bcursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/);
  return match?.[1];
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sentry API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

async function requestPaginated<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<PaginatedResult<T>> {
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sentry API ${res.status}: ${text}`);
  }

  const results = (await res.json()) as T[];
  const nextCursor = parseNextCursor(res.headers.get("Link"));
  return { results, nextCursor };
}

/** Organization-scoped path helper. */
export function orgPath(path: string) {
  return `/organizations/${env.SENTRY_ORG}${path}`;
}

/** Project-scoped path helper. */
export function projectPath(projectSlug: string, path: string) {
  return `/projects/${env.SENTRY_ORG}/${projectSlug}${path}`;
}

export function sentryGet<T>(path: string, params?: RequestOptions["params"]) {
  return request<T>(path, { params });
}

export function sentryPost<T>(path: string, body: unknown) {
  return request<T>(path, { method: "POST", body });
}

export function sentryPut<T>(path: string, body: unknown) {
  return request<T>(path, { method: "PUT", body });
}

export function sentryDelete<T>(path: string) {
  return request<T>(path, { method: "DELETE" });
}

export function sentryPaginated<T>(path: string, params?: RequestOptions["params"]) {
  return requestPaginated<T>(path, { params });
}
