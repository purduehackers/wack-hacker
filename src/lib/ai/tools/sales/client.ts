import { Resend } from "resend";

import { env } from "../../../../env.ts";
import { notion } from "../notion/client.ts";

export { notion };

let resendClient: Resend | undefined;

/** Lazy Resend client — instantiated on first access so tests can mock modules before import. */
export function resend(): Resend {
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export async function hunter<T>(
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(`https://api.hunter.io/v2/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  url.searchParams.set("api_key", env.HUNTER_API_KEY);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hunter ${path} failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}
