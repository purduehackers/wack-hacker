import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

/** Edge Config items arrive as `response.json()`, so every value is a JSON value. */
const edgeConfigItemsSchema = z.record(z.string(), z.json());

/** Parse the URL form emitted by Vercel Edge Config without retaining its token in the URL. */
function parseEdgeConfigConnection(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "https:") return undefined;
    const token = url.searchParams.get("token");
    const id = url.pathname.split("/").filter(Boolean).at(0);
    if (!token || !id) return undefined;

    const version = url.searchParams.get("version") ?? "1";
    const baseUrl =
      url.hostname === "edge-config.vercel.com"
        ? `${url.origin}/${id}`
        : `${url.origin}${url.pathname.replace(/\/$/u, "")}`;
    return {
      endpoint: `${baseUrl}/items?version=${encodeURIComponent(version)}`,
      authorization: `Bearer ${token}`,
    } as const;
  } catch {
    return undefined;
  }
}

export function isEdgeConfigConnectionConfigured(connectionString: string): boolean {
  return parseEdgeConfigConnection(connectionString) !== undefined;
}

export async function readEdgeConfigItems(connectionString: string) {
  const connection = parseEdgeConfigConnection(connectionString);
  if (connection === undefined) {
    throw new UpstreamError({
      service: "Edge Config",
      status: 503,
      detail: "connection is not configured correctly",
    });
  }

  const response = await fetch(connection.endpoint, {
    headers: { Authorization: connection.authorization },
  });
  if (!response.ok) {
    throw new UpstreamError({
      service: "Edge Config",
      status: response.status,
      detail: "organizer roster request failed",
    });
  }

  const parsed = edgeConfigItemsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UpstreamError({
      service: "Edge Config",
      status: 502,
      detail: `organizer roster response was invalid: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}
