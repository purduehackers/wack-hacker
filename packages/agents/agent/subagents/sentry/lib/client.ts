import { UpstreamError } from "@repo/shared/errors";
import { retrieveAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { env } from "./constants.ts";

/** A single value a Sentry query parameter can carry before serialization. */
type SentryQueryScalar = string | number | boolean | Date;
/** Query bag accepted by the raw Sentry helpers: scalars, repeated scalars, or absent. */
type SentryQuery = Readonly<
  Record<string, SentryQueryScalar | SentryQueryScalar[] | null | undefined>
>;

function stringifyQueryValue(value: SentryQueryScalar): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function sentryOrg(): string {
  return env.SENTRY_ORG;
}

/** Common SDK options — base URL + auth header for all Sentry API calls. */
export function sentryOpts() {
  return {
    baseUrl: "https://sentry.io" as const,
    headers: {
      Authorization: `Bearer ${env.SENTRY_API_TOKEN}`,
    },
  };
}

/** Escape a value for use in Sentry search query `field:"value"` syntax. */
export function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const BASE_URL = "https://sentry.io/api/0";
const sentryJsonSchema = z.json();

/** GET helper for endpoints not covered by generated SDK methods. */
export async function sentryGet(
  path: string,
  query?: SentryQuery,
): Promise<z.output<typeof sentryJsonSchema>> {
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
    headers: {
      Authorization: `Bearer ${env.SENTRY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Sentry API rate limited. Try again in a moment.");
    const body = await response.text().catch(() => "");
    throw new Error(`Sentry API ${response.status}: ${body.slice(0, 200)}`);
  }
  return sentryJsonSchema.parse(await response.json());
}

/** PUT helper for generated SDK endpoints whose wire schema is narrower than the server API. */
export async function sentryPut(
  path: string,
  query: SentryQuery,
  body: unknown,
): Promise<z.output<typeof sentryJsonSchema>> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, stringifyQueryValue(item));
    } else {
      url.searchParams.set(key, stringifyQueryValue(value));
    }
  }
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.SENTRY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sentryJsonSchema.parse(body)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Sentry API rate limited. Try again in a moment.");
    const responseBody = await response.text().catch(() => "");
    throw new Error(`Sentry API ${response.status}: ${responseBody.slice(0, 200)}`);
  }
  return sentryJsonSchema.parse(await response.json());
}

/**
 * Decode a raw Sentry payload against a projection, reporting a shape the
 * projection does not cover as a typed upstream failure carrying the offending
 * path rather than as a bare `ZodError` thrown out of the tool.
 */
export function sentryResponse<S extends z.ZodType>(schema: S, payload: unknown): z.output<S> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamError({
      service: "Sentry",
      status: 502,
      detail: `invalid response: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}

/** Resolve a project slug to the numeric identifier required by generated query endpoints. */
export async function sentryProjectId(projectSlug: string): Promise<number> {
  const result = await retrieveAProject({
    ...sentryOpts(),
    path: { organization_id_or_slug: sentryOrg(), project_id_or_slug: projectSlug },
  });
  const { data } = unwrapResult(result, "resolveProjectId");
  const projectId = Number(data.id);
  if (!Number.isSafeInteger(projectId))
    throw new Error(`Invalid Sentry project ID for ${projectSlug}`);
  return projectId;
}
