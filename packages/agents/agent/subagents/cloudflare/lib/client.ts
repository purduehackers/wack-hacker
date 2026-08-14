import { UpstreamError } from "@repo/shared/errors";
import Cloudflare from "cloudflare";

import { env } from "../../../env.ts";

/**
 * Lazy Cloudflare client, constructed on first use so importing this module
 * never requires a token. A missing token is not an error here — the domain
 * runtime turns it into a typed execution-time failure. Every other provider
 * in this codebase reports an absent credential the same way.
 */
let client: Cloudflare | undefined;

/**
 * The shared Cloudflare SDK instance, constructed on first call. A missing
 * token becomes an empty string here so that construction never throws.
 * Cloudflare then rejects the first request, which the domain runtime
 * reports as a typed execution-time failure.
 */
export function cloudflare(): Cloudflare {
  if (!client) client = new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN ?? "" });
  return client;
}

/**
 * The account every account-scoped call needs.
 *
 * This is a function rather than a module constant. A deployment that
 * configures the token but forgets the account id then fails at the call
 * with a typed error. A module constant would instead send `undefined`
 * into a URL path.
 */
export function accountId(): string {
  const id = env.CLOUDFLARE_ACCOUNT_ID;
  if (id === undefined) {
    throw new UpstreamError({
      service: "Cloudflare",
      status: 401,
      detail: "CLOUDFLARE_ACCOUNT_ID is not configured",
    });
  }
  return id;
}
