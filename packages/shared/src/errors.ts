/**
 * The project's error taxonomy.
 *
 * Every failure this codebase produces is a tagged class, never a bare `Error`
 * and never a string. `TaggedError(tag)` gives each one:
 *
 * - props as readonly instance fields (`error.kind`, not `error.props.kind`);
 * - `toJSON()`, so it survives the bot↔agent wire — worth stating because
 *   `Error#message` and `#stack` are non-enumerable and
 *   `JSON.stringify(new Error("x"))` is `"{}"`;
 * - a static `.is()` guard and an exhaustive instance `.match()`;
 * - `[Symbol.iterator]`, which makes an error directly yieldable inside
 *   `Result.gen`.
 *
 * Messages are derived in each constructor rather than passed in, so the same
 * failure always reads the same way in a log or an audit row.
 *
 * The one distinction that drives observability: an error declared here is
 * *expected*. A `Panic`, an `UnhandledException` from an uncaught
 * `try`/`tryPromise`, or an `InvariantViolated` is a *defect* — our bug. See
 * `isDefect`.
 */

import { TaggedError, UnhandledException, isPanic, isTaggedError } from "better-result";
import { z } from "zod";

/** The requested thing does not exist. Distinct from "you may not see it". */
export class NotFound extends TaggedError("NotFound")<{
  kind: string;
  id: string;
  message: string;
}> {
  constructor(props: { kind: string; id: string }) {
    super({ ...props, message: `${props.kind} not found: ${props.id}` });
  }
}

/**
 * The caller's role is insufficient.
 *
 * Tool gating is deny-by-absence — a tool above the caller's role is never
 * shown, so it cannot be called. This exists for the paths where absence is not
 * possible, such as `load_skill` naming a skill that exists but outranks them.
 */
export class Forbidden extends TaggedError("Forbidden")<{
  required: string;
  actual: string;
  subject: string;
  message: string;
}> {
  constructor(props: { required: string; actual: string; subject: string }) {
    super({
      ...props,
      message: `${props.subject} requires role "${props.required}" but caller has "${props.actual}"`,
    });
  }
}

/** No authenticated principal. Converted from framework `null` at the edge. */
export class Unauthenticated extends TaggedError("Unauthenticated")<{
  reason: string;
  message: string;
}> {
  constructor(props: { reason: string }) {
    super({ ...props, message: `unauthenticated: ${props.reason}` });
  }
}

/** Upstream asked us to slow down, and said for how long. Retryable. */
export class RateLimited extends TaggedError("RateLimited")<{
  service: string;
  retryAfterMs: number;
  message: string;
}> {
  constructor(props: { service: string; retryAfterMs: number }) {
    super({
      ...props,
      message: `${props.service} rate limited; retry after ${props.retryAfterMs}ms`,
    });
  }
}

/** A failure a later attempt could plausibly survive. Retryable. */
export class Transient extends TaggedError("Transient")<{
  operation: string;
  detail: string;
  message: string;
}> {
  constructor(props: { operation: string; detail: string }) {
    super({ ...props, message: `${props.operation} failed transiently: ${props.detail}` });
  }
}

/**
 * Work stopped at an ambiguous boundary and requires an explicit safe repair.
 * Retrying the same operation is forbidden because it could repeat a side effect.
 */
export class RecoveryRequired extends TaggedError("RecoveryRequired")<{
  operation: string;
  detail: string;
  remediation: string;
  message: string;
}> {
  constructor(props: { operation: string; detail: string; remediation: string }) {
    super({
      ...props,
      message: `${props.operation} requires recovery: ${props.detail}; ${props.remediation}`,
    });
  }
}

/** Input failed validation. Never retryable: the same input fails identically. */
export class InvalidInput extends TaggedError("InvalidInput")<{
  subject: string;
  issues: readonly string[];
  message: string;
}> {
  constructor(props: { subject: string; issues: readonly string[] }) {
    super({ ...props, message: `invalid ${props.subject}: ${props.issues.join("; ")}` });
  }
}

/** An upstream service answered with a failure retrying will not fix. */
export class UpstreamError extends TaggedError("UpstreamError")<{
  service: string;
  status: number;
  detail: string;
  message: string;
}> {
  constructor(props: { service: string; status: number; detail: string }) {
    super({
      ...props,
      message: `${props.service} returned ${props.status}: ${props.detail}`,
    });
  }
}

/**
 * A contract between two of our own components was violated — a payload that
 * passed transport but not schema, a lease released by the wrong owner. Always
 * our bug, so it counts as a defect despite being tagged.
 */
export class InvariantViolated extends TaggedError("InvariantViolated")<{
  invariant: string;
  detail: string;
  message: string;
}> {
  constructor(props: { invariant: string; detail: string }) {
    super({
      ...props,
      message: `invariant "${props.invariant}" violated: ${props.detail}`,
    });
  }
}

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
 * Defects belong in Sentry Issues; expected failures belong in metrics. The
 * prior error handling blurred this and compensated with an
 * `ignoreErrors: ["LockContentionError", "DuplicateMessageError"]` denylist.
 * With tags the distinction is structural, so no denylist is needed.
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
 * `Number(...)` reproduces what the hand-written guard did — an SDK that
 * reports `"404"` still resolves — and `.catch(undefined)` keeps one unusable
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
