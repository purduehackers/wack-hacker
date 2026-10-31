/** Create short links through the phack.rs API; keep the same slug after uncertain writes. */

import { createClient } from "@purduehackers/phack";
import { z } from "zod";

import { messageOf } from "./errors.ts";

export const PHACK_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}[A-Za-z0-9]$/u;
export const PHACK_RESERVED_SLUGS = new Set(["404", "api", "dashboard", "favicon", "login"]);

const storedLink = z.object({ d: z.string() });
const createdLink = z.object({
  slug: z.string(),
  d: z.string(),
  status: z.enum(["created", "existing"]),
});

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
  client: ReturnType<typeof createClient>,
): Promise<"same" | "exists" | undefined> {
  try {
    // The write signal may already be aborted. Reconcile with a separate bounded read.
    const response = await client
      .links({ slug })
      .get({ fetch: { signal: AbortSignal.timeout(3_000) } });
    if (response.status !== 200) return undefined;
    const parsed = storedLink.safeParse(response.data);
    if (!parsed.success) return undefined;
    return parsed.data.d === destination ? "same" : "exists";
  } catch {
    return undefined;
  }
}

/** Does not retry writes. A lost response triggers one read of the original slug. */
export async function writePhackLink(input: {
  readonly slug: string;
  readonly destination: string;
  readonly token: string;
  readonly signal: AbortSignal;
  readonly url?: string;
}): Promise<PhackWriteResult> {
  const { slug, destination, token, signal, url = "https://phack.rs" } = input;
  const client = createClient(url, token);
  try {
    const response = await client.links.post({ slug, destination }, { fetch: { signal } });
    const status = response.status;
    if (status === 200) {
      const parsed = createdLink.safeParse(response.data);
      if (parsed.success && parsed.data.slug === slug && parsed.data.d === destination) {
        return { kind: parsed.data.status === "created" ? "created" : "same" };
      }
    }
    // The API only returns 409 after confirming that this slug points elsewhere.
    if (status === 409) return { kind: "exists" };
    const detail = `Short-link API returned ${status}`;
    if (status === 400 || status === 422) return { kind: "invalid_request", status, detail };
    if (status === 200 || status === 408 || status >= 500) {
      const existing = await existingLink(slug, destination, client);
      return existing === undefined ? { kind: "unverified", status, detail } : { kind: existing };
    }
    return { kind: "error", status, detail };
  } catch (cause) {
    const existing = await existingLink(slug, destination, client);
    return existing === undefined
      ? { kind: "unverified", detail: messageOf(cause) }
      : { kind: existing };
  }
}
