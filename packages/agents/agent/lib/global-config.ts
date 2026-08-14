/**
 * Reads items out of a Vercel Global Config store.
 *
 * Vercel renamed Edge Config to Global Config. Ids still carry the `ecfg_`
 * prefix, and existing connection strings still point at
 * `edge-config.vercel.com`, so both forms have to keep working. Nothing here
 * reads the hostname, which is what makes that free.
 *
 * One `fetch` rather than `@vercel/global-config`, so this workspace needs no
 * dependency for a single GET.
 */

import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

const SERVICE = "Global Config";

/** Global Config items arrive as `response.json()`, so every value is a JSON value. */
const globalConfigItemsSchema = z.record(z.string(), z.json());

/** Parse the URL form Vercel emits, without retaining its token in the URL. */
function parseGlobalConfigConnection(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "https:") return undefined;
    const token = url.searchParams.get("token");
    const id = url.pathname.split("/").filter(Boolean).at(0);
    if (!token || !id) return undefined;

    const version = url.searchParams.get("version") ?? "1";
    const baseUrl = `${url.origin}${url.pathname.replace(/\/$/u, "")}`;
    return {
      endpoint: `${baseUrl}/items?version=${encodeURIComponent(version)}`,
      authorization: `Bearer ${token}`,
    } as const;
  } catch {
    return undefined;
  }
}

/**
 * True when the connection string parses into a usable endpoint. Policy uses
 * this to hide the organizer lookup rather than fail it at request time.
 */
export function isGlobalConfigConnectionConfigured(connectionString: string): boolean {
  return parseGlobalConfigConnection(connectionString) !== undefined;
}

/**
 * Fetches every item in the store in one authenticated GET.
 *
 * @throws UpstreamError when the connection string does not parse, the request
 *   fails, or the response is not a JSON record.
 */
export async function readGlobalConfigItems(connectionString: string) {
  const connection = parseGlobalConfigConnection(connectionString);
  if (connection === undefined) {
    throw new UpstreamError({
      service: SERVICE,
      status: 503,
      detail: "connection is not configured correctly",
    });
  }

  const response = await fetch(connection.endpoint, {
    headers: { Authorization: connection.authorization },
  });
  if (!response.ok) {
    throw new UpstreamError({
      service: SERVICE,
      status: response.status,
      detail: "organizer roster request failed",
    });
  }

  const parsed = globalConfigItemsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UpstreamError({
      service: SERVICE,
      status: 502,
      detail: `organizer roster response was invalid: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}
