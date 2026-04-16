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

const BASE_URL = "https://sentry.io/api/0";

/** Raw GET helper for endpoints not covered by the SDK. */
export async function sentryGet<T = unknown>(path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
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
