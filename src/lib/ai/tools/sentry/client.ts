import { env } from "../../../../env.ts";

const BASE_URL = "https://sentry.io/api/0";

export function sentryOrg(): string {
  return env.SENTRY_ORG;
}

export async function sentryFetch(path: string, options?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(url, {
    ...options,
    headers,
    signal: options?.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Sentry API rate limited. Try again in a moment.");
    const body = await response.text().catch(() => "");
    throw new Error(`Sentry API ${response.status}: ${body.slice(0, 200)}`);
  }
  return response;
}

/** GET request returning parsed JSON. */
export async function sentryGet<T = unknown>(path: string): Promise<T> {
  const res = await sentryFetch(path);
  return res.json() as Promise<T>;
}

/** POST / PUT / DELETE request returning parsed JSON (or `{ deleted: true }` for DELETE). */
export async function sentryMutate<T = unknown>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await sentryFetch(path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE") return { deleted: true } as T;
  return res.json() as Promise<T>;
}
