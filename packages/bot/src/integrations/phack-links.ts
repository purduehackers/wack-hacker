/** Create phack.rs redirects in the Global Config read by the redirect middleware. */

import { messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { z } from "zod";

const CONFIG_ID = "ecfg_k1ocmrcfwo57k9v2klgtljycqsqj";
const TEAM_ID = "team_kOQWJUQYzGW4blWthdK71Y8A";
const CONFIG_URL = `https://api.vercel.com/v1/global-config/${CONFIG_ID}`;
const SCOPE = `teamId=${TEAM_ID}`;

export type CreateLinkOutcome = "created" | "exists" | "same";
export type CreateLinkError = Transient | UpstreamError;

export interface PhackLinkWriter {
  readonly create: (
    slug: string,
    destination: string,
  ) => Promise<Result<CreateLinkOutcome, CreateLinkError>>;
}

const storedLink = z.looseObject({ value: z.looseObject({ d: z.string() }) });

/** Reconcile an uncertain create against the stored destination without another write. */
async function existingLink(
  slug: string,
  destination: string,
  token: string,
): Promise<"exists" | "same" | undefined> {
  try {
    const response = await fetch(`${CONFIG_URL}/item/${encodeURIComponent(slug)}?${SCOPE}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return undefined;
    const parsed = storedLink.safeParse(await response.json());
    return parsed.success && parsed.data.value.d === destination ? "same" : "exists";
  } catch {
    return undefined;
  }
}

export function createPhackLinkWriter(token: string): PhackLinkWriter {
  return {
    create: (slug, destination) =>
      Result.tryPromise({
        try: async () => {
          let response: Response;
          try {
            response = await fetch(`${CONFIG_URL}/items?${SCOPE}`, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                items: [{ operation: "create", key: slug, value: { d: destination, v: 0 } }],
              }),
              signal: AbortSignal.timeout(10_000),
            });
          } catch (cause) {
            const existing = await existingLink(slug, destination, token);
            if (existing !== undefined) return existing;
            throw cause;
          }
          if (response.ok) return "created" as const;
          if (
            response.status === 400 ||
            response.status === 408 ||
            response.status === 409 ||
            response.status >= 500
          ) {
            const existing = await existingLink(slug, destination, token);
            if (existing !== undefined) return existing;
          }

          const detail = (await response.text().catch(() => "")).slice(0, 200);
          throw response.status < 500
            ? new UpstreamError({
                service: "vercel-global-config",
                status: response.status,
                detail,
              })
            : new Transient({ operation: "create phack.rs link", detail });
        },
        catch: (cause) =>
          cause instanceof UpstreamError || cause instanceof Transient
            ? cause
            : new Transient({ operation: "create phack.rs link", detail: messageOf(cause) }),
      }),
  };
}
