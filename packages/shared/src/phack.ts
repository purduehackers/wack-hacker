/** Create phack.rs redirects in the Vercel Global Config read by the redirect middleware. */

import { z } from "zod";

import { messageOf } from "./errors.ts";

const CONFIG_URL = "https://api.vercel.com/v1/global-config/ecfg_k1ocmrcfwo57k9v2klgtljycqsqj";
const TEAM_QUERY = "teamId=team_kOQWJUQYzGW4blWthdK71Y8A";
export const PHACK_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}[A-Za-z0-9]$/u;
export const PHACK_RESERVED_SLUGS = new Set(["404", "api", "dashboard", "favicon", "login"]);

const storedLink = z.looseObject({ value: z.looseObject({ d: z.string() }) });

export type PhackWriteResult =
  | { readonly kind: "created" | "same" | "exists" }
  | {
      readonly kind: "invalid_request" | "conflict" | "unverified";
      readonly status?: number;
      readonly detail: string;
    }
  | { readonly kind: "error"; readonly status: number; readonly detail: string };

async function existingLink(
  slug: string,
  destination: string,
  token: string,
): Promise<"same" | "exists" | undefined> {
  try {
    const response = await fetch(`${CONFIG_URL}/item/${encodeURIComponent(slug)}?${TEAM_QUERY}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status === 204 || !response.ok) return undefined;
    const parsed = storedLink.safeParse(await response.json());
    if (!parsed.success) return undefined;
    return parsed.data.value.d === destination ? "same" : "exists";
  } catch {
    return undefined;
  }
}

export async function writePhackLink(input: {
  readonly slug: string;
  readonly destination: string;
  readonly token: string;
  readonly signal: AbortSignal;
}): Promise<PhackWriteResult> {
  const { slug, destination, token, signal } = input;
  let response: Response;
  try {
    response = await fetch(`${CONFIG_URL}/items?${TEAM_QUERY}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ operation: "create", key: slug, value: { d: destination, v: 0 } }],
      }),
      signal,
    });
  } catch (cause) {
    const existing = await existingLink(slug, destination, token);
    return existing === undefined
      ? { kind: "unverified", detail: messageOf(cause) }
      : { kind: existing };
  }
  if (response.ok) return { kind: "created" };

  const status = response.status;
  if (status === 400 || status === 408 || status === 409 || status >= 500) {
    const existing = await existingLink(slug, destination, token);
    if (existing !== undefined) return { kind: existing };
  }
  const detail = (await response.text().catch(() => "")).slice(0, 200);
  if (status === 400) return { kind: "invalid_request", status, detail };
  if (status === 409) return { kind: "conflict", status, detail };
  if (status === 408 || status >= 500) return { kind: "unverified", status, detail };
  return { kind: "error", status, detail };
}
