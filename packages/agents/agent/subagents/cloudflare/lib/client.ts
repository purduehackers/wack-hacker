import { UpstreamError } from "@repo/shared/errors";
import Cloudflare from "cloudflare";

import { env } from "../../../env.ts";

/**
 * Lazy Cloudflare client, constructed on first use so importing this module
 * never requires a token. A missing token is not an error here — the domain
 * runtime turns it into a typed execution-time failure, which is how every
 * other provider in this codebase reports an absent credential.
 */
let client: Cloudflare | undefined;

export function cloudflare(): Cloudflare {
  if (!client) client = new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN ?? "" });
  return client;
}

/**
 * The account every account-scoped call needs.
 *
 * Read through a function rather than a module constant so a deployment that
 * configures the token but forgets the account id fails at the call with a
 * typed error, rather than sending `undefined` into a URL path.
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
