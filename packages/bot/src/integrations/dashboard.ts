/**
 * Writes the hack night version to the dashboard's Vercel Edge Config.
 *
 * The dashboard reads `version` from Edge Config at request time, so this is how
 * `/hack-night start` changes what the site shows.
 *
 * Uses the REST endpoint directly rather than `@vercel/sdk`. The prior code
 * called `vercel.edgeConfig.patchEdgeConfigItems(...)`, but that accessor no
 * longer exists: as of `@vercel/sdk` 1.28 the Edge Config operations moved under
 * `globalConfig` and the item-*write* methods were dropped entirely, leaving only
 * reads. This is the same HTTP call the SDK used to make, without depending on a
 * large SDK for one request.
 *
 * Kept behind the `DashboardWriter` interface the command depends on, so this
 * file is the only thing that knows Edge Config exists.
 */

import { Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";
import { parseConnectionString } from "@vercel/edge-config";

import type { DashboardWriter, HackNightError } from "../commands/hack-night.ts";

const VERCEL_API = "https://api.vercel.com";

export interface DashboardDeps {
  readonly vercelToken: string;
  /** The dashboard's Edge Config connection string, not the bot's own. */
  readonly connectionString: string;
}

/**
 * Extracts the Edge Config id from its connection string.
 *
 * Resolved once at construction rather than per call, so a malformed connection
 * string fails at startup instead of the first time an organizer runs the
 * command during a hack night.
 */
function edgeConfigIdFrom(connectionString: string): Result<string, UpstreamError> {
  const connection = parseConnectionString(connectionString);
  if (!connection) {
    return Result.err(
      new UpstreamError({
        service: "vercel-edge-config",
        status: 0,
        detail: "not a valid Edge Config connection string",
      }),
    );
  }
  return Result.ok(connection.id);
}

export function createDashboardWriter(deps: DashboardDeps): Result<DashboardWriter, UpstreamError> {
  const edgeConfigId = edgeConfigIdFrom(deps.connectionString);
  if (Result.isError(edgeConfigId)) return edgeConfigId;

  const url = `${VERCEL_API}/v1/edge-config/${edgeConfigId.value}/items`;

  return Result.ok({
    setVersion: async (version: string): Promise<Result<undefined, HackNightError>> =>
      Result.tryPromise(
        {
          try: async () => {
            const response = await fetch(url, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${deps.vercelToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                items: [{ operation: "upsert", key: "version", value: version }],
              }),
            });

            if (!response.ok) {
              const detail = (await response.text().catch(() => "")).slice(0, 200);
              // A 4xx means the token or id is wrong and retrying cannot help;
              // a 5xx is worth another attempt.
              throw response.status < 500
                ? new UpstreamError({
                    service: "vercel-edge-config",
                    status: response.status,
                    detail,
                  })
                : new Transient({ operation: "edge config upsert", detail });
            }

            return undefined;
          },
          catch: (cause) =>
            cause instanceof UpstreamError || cause instanceof Transient
              ? cause
              : new Transient({
                  operation: "edge config upsert",
                  detail: cause instanceof Error ? cause.message : String(cause),
                }),
        },
        upstreamRetry,
      ),
  });
}
