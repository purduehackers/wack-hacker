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

import {
  InvalidInput,
  messageOf,
  RateLimited,
  Transient,
  UpstreamError,
} from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";
import { z } from "zod";

const SHIPS_URL = "https://ships.purduehackers.com";

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

export type ShipsError = InvalidInput | RateLimited | Transient | UpstreamError;

/**
 * Response shapes, validated rather than cast.
 *
 * `.loose()` because the gallery may add fields; we only depend on these.
 */
const createResponseSchema = z
  .looseObject({
    id: z.union([z.string(), z.number()]).transform(String),
    alreadyExists: z.boolean().default(false),
  })
  .transform(({ id, alreadyExists }) => ({ id, alreadyExists }) as const);

const deleteResponseSchema = z
  .looseObject({
    ok: z.boolean().default(false),
    id: z.string().optional(),
    attachmentsRemoved: z.number().default(0),
  })
  .transform(
    ({ ok, id, attachmentsRemoved }) => ({ deleted: ok, id, attachmentsRemoved }) as const,
  );

export type CreateShipResult = z.output<typeof createResponseSchema>;
export type DeleteShipResult = z.output<typeof deleteResponseSchema>;

function parseOr<S extends z.ZodType>(schema: S, subject: string, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  // The path, not just the message: "alreadyExists: expected boolean" is
  // actionable where a bare "expected boolean" is not.
  throw new InvalidInput({
    subject,
    issues: parsed.error.issues.map(({ message, path }) =>
      path.length === 0 ? message : `${path.join(".")}: ${message}`,
    ),
  });
}

export interface ShipsDeps {
  readonly apiKey: string;
}

function classify(status: number, detail: string): ShipsError {
  if (status === 429) return new RateLimited({ service: "ships", retryAfterMs: 1_000 });
  if (status >= 500) return new Transient({ operation: "ships request", detail });
  return new UpstreamError({ service: "ships", status, detail });
}

/**
 * Passes a failure `classify` or `parseOr` already typed straight through;
 * anything else reached us as a transport fault, which is retryable.
 */
function toShipsError(operation: string) {
  return (cause: unknown): ShipsError =>
    cause instanceof InvalidInput ||
    cause instanceof RateLimited ||
    cause instanceof Transient ||
    cause instanceof UpstreamError
      ? cause
      : new Transient({
          operation,
          detail: messageOf(cause),
        });
}

export function createShipsClient(deps: ShipsDeps) {
  const headers = {
    Authorization: `Bearer ${deps.apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    createShip: async (input: CreateShipInput): Promise<Result<CreateShipResult, ShipsError>> =>
      Result.tryPromise(
        {
          try: async () => {
            const response = await fetch(`${SHIPS_URL}/api/ships`, {
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

            return parseOr(createResponseSchema, "ships create response", await response.json());
          },
          catch: toShipsError("create ship"),
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
            const response = await fetch(
              `${SHIPS_URL}/api/ships/${encodeURIComponent(messageId)}`,
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

            return parseOr(deleteResponseSchema, "ships delete response", await response.json());
          },
          catch: toShipsError("delete ship"),
        },
        upstreamRetry,
      ),
  };
}

export type ShipsClient = ReturnType<typeof createShipsClient>;
