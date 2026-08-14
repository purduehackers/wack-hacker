/**
 * @fileoverview Helpers that classify, project, and read thrown values.
 *
 * The error classes themselves live in `./errors.ts`. This module holds the
 * functions and types that operate on them. `errors.ts` re-exports everything
 * here, so importers keep one entry point: `@repo/shared/errors`.
 */

import { UnhandledException, isPanic, isTaggedError } from "better-result";
import { z } from "zod";

import type {
  Forbidden,
  InvalidInput,
  NotFound,
  RecoveryRequired,
  Unauthenticated,
  UpstreamError,
} from "./tagged-errors.ts";
import { InvariantViolated, RateLimited, Transient } from "./tagged-errors.ts";

/** Union of every error this codebase raises deliberately. */
export type KnownError =
  | Forbidden
  | InvalidInput
  | InvariantViolated
  | NotFound
  | RateLimited
  | RecoveryRequired
  | Transient
  | Unauthenticated
  | UpstreamError;

/**
 * True when a failure means "we are broken" rather than "that didn't work".
 *
 * Defects belong in Sentry Issues. Expected failures belong in metrics. The
 * prior error handling blurred this and compensated with an
 * `ignoreErrors: ["LockContentionError", "DuplicateMessageError"]` denylist.
 * With tags the distinction is structural, so no denylist is necessary.
 */
export function isDefect(value: unknown): boolean {
  if (isPanic(value)) return true;
  if (UnhandledException.is(value)) return true;
  if (InvariantViolated.is(value)) return true;
  return !isTaggedError(value);
}

/** Retry only where a later attempt could plausibly differ. */
export function isRetryable(value: unknown): boolean {
  return RateLimited.is(value) || Transient.is(value);
}

/** How long the error itself says to wait, when it knows. */
export function retryAfterMs(value: unknown): number | undefined {
  return RateLimited.is(value) ? value.retryAfterMs : undefined;
}

/**
 * Tag for any thrown value, for logs and metric dimensions. Untagged values
 * collapse to "Defect" so dashboard cardinality stays bounded.
 */
export function tagOf(value: unknown): string {
  if (isPanic(value)) return "Panic";
  if (isTaggedError(value)) return value._tag;
  return "Defect";
}

/**
 * `Number(...)` reproduces what the hand-written guard did: an SDK that
 * reports `"404"` still resolves. `.catch(undefined)` keeps one unusable
 * field from hiding a usable one on the other key.
 */
const httpStatusSchema = z.coerce
  .number()
  .pipe(z.int().min(100).max(599))
  .optional()
  .catch(undefined);
const statusCarrierSchema = z.object({
  status: httpStatusSchema,
  statusCode: httpStatusSchema,
});

/**
 * Reads an HTTP status off an unknown thrown value.
 *
 * SDKs disagree on where they put it — discord.js and Octokit use `status`,
 * others use `statusCode` — and none of them narrow to a useful type. This is
 * the one place that guesswork lives, so mapping an upstream throw onto
 * `UpstreamError` or `RateLimited` does not re-derive it at every call site.
 */
export function httpStatusOf(value: unknown): number | undefined {
  const carrier = statusCarrierSchema.safeParse(value);
  if (!carrier.success) return undefined;
  return carrier.data.status ?? carrier.data.statusCode;
}

/** Wire-safe projection of an error. Flat, JSON-safe, and free of stack traces. */
interface SerializedError {
  readonly tag: string;
  readonly message: string;
}

/**
 * Reduces any thrown value to a tag and a message.
 *
 * Deliberately narrower than the built-in `toJSON()`, which also emits `stack`
 * and `cause`. Those are useful locally and inappropriate to hand to another
 * service — or, once a message reaches Discord, to end users.
 */
export function serializeError(value: unknown): SerializedError {
  if (isTaggedError(value) || isPanic(value)) {
    return { tag: tagOf(value), message: value.message };
  }
  if (value instanceof Error) return { tag: "Defect", message: value.message };
  return { tag: "Defect", message: String(value) };
}

/**
 * What a thrown value says, whatever it turned out to be.
 *
 * Two dozen places across this repo write out
 * `cause instanceof Error ? cause.message : String(cause)` by hand. Every one
 * of them means this.
 */
export function messageOf(value: unknown): string {
  return serializeError(value).message;
}
