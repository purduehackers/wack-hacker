/**
 * Client for the ship gallery at ships.purduehackers.com.
 *
 * Anything posted in `#ship` is mirrored to the public gallery. The service
 * downloads the media itself given source URLs, so this only forwards metadata.
 *
 * Creation is idempotent on `messageId` — the service answers `alreadyExists`
 * rather than duplicating — which matters because a gateway `RESUME` can replay
 * the message that triggered it.
 */

import { InvalidInput, RateLimited, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";
import { z } from "zod";

export const SHIPS_URL = "https://ships.purduehackers.com";

export interface ShipAttachmentInput {
  readonly sourceUrl: string;
  readonly type: string;
  readonly filename: string;
  readonly width?: number;
  readonly height?: number;
}

export interface CreateShipInput {
  readonly userId: string;
  readonly username: string;
  readonly avatarUrl: string;
  readonly messageId: string;
  readonly title: string | undefined;
  readonly content: string;
  readonly attachments: readonly ShipAttachmentInput[];
}

export interface CreateShipResult {
  readonly id: string;
  readonly alreadyExists: boolean;
}

export interface DeleteShipResult {
  readonly deleted: boolean;
  readonly id: string | undefined;
  readonly attachmentsRemoved: number;
}

export type ShipsError = InvalidInput | RateLimited | Transient | UpstreamError;

/**
 * Response shapes, validated rather than cast.
 *
 * `.loose()` because the gallery may add fields; we only depend on these.
 */
const createResponseSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  alreadyExists: z.boolean().optional(),
});

const deleteResponseSchema = z.looseObject({
  ok: z.boolean().optional(),
  id: z.string().optional(),
  attachmentsRemoved: z.number().optional(),
});

function parseOr<T>(schema: z.ZodType<T>, subject: string, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new InvalidInput({
    subject,
    issues: parsed.error.issues.map((failure) => failure.message),
  });
}

export interface ShipsDeps {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

function classify(status: number, detail: string): ShipsError {
  if (status === 429) return new RateLimited({ service: "ships", retryAfterMs: 1_000 });
  if (status >= 500) return new Transient({ operation: "ships request", detail });
  return new UpstreamError({ service: "ships", status, detail });
}

export function createShipsClient(deps: ShipsDeps) {
  const baseUrl = (deps.baseUrl ?? SHIPS_URL).replace(/\/$/, "");
  const doFetch = deps.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${deps.apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    createShip: async (input: CreateShipInput): Promise<Result<CreateShipResult, ShipsError>> =>
      Result.tryPromise(
        {
          try: async () => {
            const response = await doFetch(`${baseUrl}/api/ships`, {
              method: "POST",
              headers,
              body: JSON.stringify(input),
            });

            if (!response.ok) {
              throw classify(
                response.status,
                (await response.text().catch(() => "")).slice(0, 200),
              );
            }

            const created = parseOr(
              createResponseSchema,
              "ships create response",
              await response.json(),
            );
            return { id: created.id, alreadyExists: created.alreadyExists ?? false };
          },
          catch: (cause) =>
            cause instanceof InvalidInput ||
            cause instanceof RateLimited ||
            cause instanceof Transient ||
            cause instanceof UpstreamError
              ? cause
              : new Transient({
                  operation: "create ship",
                  detail: cause instanceof Error ? cause.message : String(cause),
                }),
        },
        upstreamRetry,
      ),

    /**
     * Removes the ship for a Discord message.
     *
     * A 404 is success with `deleted: false`, not a failure: a message deleted
     * from `#ship` that was never mirrored is the common case, and treating it
     * as an error would report noise on every non-ship deletion.
     */
    deleteShipByMessageId: async (
      messageId: string,
    ): Promise<Result<DeleteShipResult, ShipsError>> =>
      Result.tryPromise(
        {
          try: async () => {
            const response = await doFetch(
              `${baseUrl}/api/ships/${encodeURIComponent(messageId)}`,
              { method: "DELETE", headers },
            );

            if (response.status === 404) {
              return { deleted: false, id: undefined, attachmentsRemoved: 0 };
            }
            if (!response.ok) {
              throw classify(
                response.status,
                (await response.text().catch(() => "")).slice(0, 200),
              );
            }

            const body = parseOr(
              deleteResponseSchema,
              "ships delete response",
              await response.json(),
            );
            return {
              deleted: body.ok ?? false,
              id: body.id,
              attachmentsRemoved: body.attachmentsRemoved ?? 0,
            };
          },
          catch: (cause) =>
            cause instanceof InvalidInput ||
            cause instanceof RateLimited ||
            cause instanceof Transient ||
            cause instanceof UpstreamError
              ? cause
              : new Transient({
                  operation: "delete ship",
                  detail: cause instanceof Error ? cause.message : String(cause),
                }),
        },
        upstreamRetry,
      ),
  };
}

export type ShipsClient = ReturnType<typeof createShipsClient>;
