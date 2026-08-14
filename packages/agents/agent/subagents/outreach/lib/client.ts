import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../../env.ts";
import { notion } from "../../notion/lib/client.ts";

export { notion };

/**
 * GET against the Hunter v2 API with the key from the environment. Skips
 * `undefined` params, so optional filters stay absent from the query string.
 * The caller's schema validates the response, so a Hunter shape change fails
 * loudly at the boundary.
 */
export async function hunter<S extends z.ZodType>(
  path: string,
  params: Record<string, string | undefined>,
  schema: S,
): Promise<z.output<S>> {
  const url = new URL(`https://api.hunter.io/v2/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  url.searchParams.set("api_key", env.HUNTER_API_KEY ?? "");

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hunter ${path} failed (${response.status}): ${body}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UpstreamError({
      service: "Hunter",
      status: 502,
      detail: `invalid ${path} response: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}
