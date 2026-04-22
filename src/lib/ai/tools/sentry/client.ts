import { env } from "../../../../env.ts";

export function sentryOrg(): string {
  return env.SENTRY_ORG;
}

/** Common SDK options — base URL + auth header for all Sentry API calls. */
export function sentryOpts() {
  return {
    baseUrl: "https://sentry.io" as const,
    headers: {
      Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`,
    },
  };
}

/** Escape a value for use in Sentry search query `field:"value"` syntax. */
export function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const BASE_URL = "https://sentry.io/api/0";

function primitiveString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** GET helper for endpoints not covered by generated SDK methods. */
export async function sentryGet<T = unknown>(
  path: string,
  query?: Record<string, unknown>,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, primitiveString(v));
      } else if (typeof value === "object") {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, primitiveString(value));
      }
    }
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Sentry API rate limited. Try again in a moment.");
    const body = await response.text().catch(() => "");
    throw new Error(`Sentry API ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}
