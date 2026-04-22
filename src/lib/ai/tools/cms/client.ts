import { PayloadSDK, PayloadSDKError } from "@payloadcms/sdk";

import { env } from "../../../../env.ts";

const CMS_WEB_ORIGIN = "https://cms.purduehackers.com";
const CMS_API_URL = `${CMS_WEB_ORIGIN}/api`;
const CMS_AUTH_COLLECTION = "service-accounts";

/**
 * Payload CMS SDK client for `cms.purduehackers.com`.
 *
 * Auth: Payload's API-key header format is `Authorization: {collection}
 * API-Key {key}`, where the collection is the auth-enabled collection the
 * key was minted for. We auth as a service account.
 */
export const payload = new PayloadSDK({
  baseURL: CMS_API_URL,
  baseInit: {
    headers: {
      Authorization: `${CMS_AUTH_COLLECTION} API-Key ${env.PAYLOAD_CMS_API_KEY}`,
    },
  },
});

/** Build a link to the Payload admin UI for a single document. */
export function cmsAdminUrl(slug: string, id: number | string): string {
  return `${CMS_WEB_ORIGIN}/admin/collections/${slug}/${id}`;
}

/** Resolve pagination input to SDK-ready args with defaults. */
export function paginationQuery(input: { limit?: number; page?: number; sort?: string }): {
  limit: number;
  page: number;
  sort?: string;
} {
  return {
    limit: input.limit ?? 25,
    page: input.page ?? 1,
    ...(input.sort ? { sort: input.sort } : {}),
  };
}

/**
 * Normalize errors thrown by the Payload SDK into messages the agent can
 * surface to the user. 401 → auth hint, 404 → id/slug hint, others →
 * status + first error message if present.
 */
export function wrapPayloadError(err: unknown): Error {
  if (err instanceof PayloadSDKError) {
    if (err.status === 401) {
      return new Error("Payload CMS 401: check PAYLOAD_CMS_API_KEY");
    }
    if (err.status === 404) {
      return new Error(`Payload CMS 404: ${err.message} — check id/slug.`);
    }
    const detail = err.errors?.[0]?.message;
    const suffix = detail ? ` — ${detail}` : "";
    return new Error(`Payload CMS ${err.status}: ${err.message}${suffix}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
