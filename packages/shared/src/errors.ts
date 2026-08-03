/**
 * The project's error taxonomy.
 *
 * Every failure this codebase can produce is a tagged class, never a bare
 * `Error` and never a string. Call sites branch on `_tag`, so error handling is
 * exhaustive at the type level — `TaggedError.match` will not compile until
 * every variant is handled. This replaces the legacy app's status-code-then-
 * message-regex ladder in `classifyToolError`, which could only guess.
 *
 * Two invariants worth stating up front:
 *
 * 1. `AppError` carries its data in a frozen `props` object rather than ad-hoc
 *    fields, so it can be serialized generically. `Error`'s own `message` and
 *    `stack` are non-enumerable, which means `JSON.stringify(new Error("x"))`
 *    is `"{}"` — an error crossing the bot↔agent wire would otherwise arrive
 *    completely empty. `toJSON` is what prevents that.
 *
 * 2. An `AppError` is *expected*. Anything else — a raw throw, or
 *    better-result's `UnhandledException` from an uncaught `try`/`tryPromise` —
 *    is a *defect*. That distinction drives observability: expected failures
 *    are counted, defects are paged. See `isDefect`.
 */

import { TaggedError, UnhandledException } from "better-result";

/**
 * Wire shape of an error. Flat and JSON-safe by construction.
 *
 * `props` is `object` rather than `Record<string, unknown>` so any error's
 * concrete props type is assignable without a cast — TypeScript does not treat
 * a specific interface as assignable to an index signature.
 */
export interface SerializedError {
  readonly _tag: string;
  readonly message: string;
  readonly props: object;
}

export abstract class AppError<P extends object = Record<string, never>> extends TaggedError {
  abstract override readonly _tag: string;

  readonly props: Readonly<P>;

  constructor(message: string, props: P, options?: ErrorOptions) {
    super(message, options);
    this.props = Object.freeze({ ...props });
  }

  toJSON(): SerializedError {
    return { _tag: this._tag, message: this.message, props: this.props };
  }
}

/** The requested thing does not exist. Distinct from "you may not see it". */
export class NotFound extends AppError<{ kind: string; id: string }> {
  readonly _tag = "NotFound" as const;

  constructor(props: { kind: string; id: string }) {
    super(`${props.kind} not found: ${props.id}`, props);
  }
}

/**
 * The caller's role is insufficient. Note that the agent's tool gating is
 * deny-by-absence — a tool above the caller's role is never shown, so it
 * cannot be called. This error is for the paths where absence isn't possible,
 * such as a `load_skill` naming a skill that exists but outranks the caller.
 */
export class Forbidden extends AppError<{ required: string; actual: string; subject?: string }> {
  readonly _tag = "Forbidden" as const;

  constructor(props: { required: string; actual: string; subject?: string }) {
    super(
      `requires role "${props.required}" but caller has "${props.actual}"${
        props.subject === undefined ? "" : ` (${props.subject})`
      }`,
      props,
    );
  }
}

/** No authenticated principal. Converted from framework `null` at the edge. */
export class Unauthenticated extends AppError<{ reason: string }> {
  readonly _tag = "Unauthenticated" as const;

  constructor(props: { reason: string }) {
    super(`unauthenticated: ${props.reason}`, props);
  }
}

/** Upstream asked us to slow down. Retryable, and it tells us for how long. */
export class RateLimited extends AppError<{ service: string; retryAfterMs: number }> {
  readonly _tag = "RateLimited" as const;

  constructor(props: { service: string; retryAfterMs: number }) {
    super(`${props.service} rate limited; retry after ${props.retryAfterMs}ms`, props);
  }
}

/** A failure that is expected to succeed on a later attempt. Retryable. */
export class Transient extends AppError<{ operation: string; detail: string }> {
  readonly _tag = "Transient" as const;

  constructor(props: { operation: string; detail: string }, options?: ErrorOptions) {
    super(`${props.operation} failed transiently: ${props.detail}`, props, options);
  }
}

/** Input failed validation. Never retryable — the same input fails the same way. */
export class InvalidInput extends AppError<{ subject: string; issues: readonly string[] }> {
  readonly _tag = "InvalidInput" as const;

  constructor(props: { subject: string; issues: readonly string[] }) {
    super(`invalid ${props.subject}: ${props.issues.join("; ")}`, props);
  }
}

/** An upstream service answered, but with a failure we cannot fix by retrying. */
export class UpstreamError extends AppError<{ service: string; status: number; detail: string }> {
  readonly _tag = "UpstreamError" as const;

  constructor(props: { service: string; status: number; detail: string }) {
    super(`${props.service} returned ${props.status}: ${props.detail}`, props);
  }
}

/**
 * A contract between two of our own components was violated — a wire payload
 * that passed transport but not schema, a lease released by the wrong owner.
 * Always a bug on our side, so it is reported as a defect despite being tagged.
 */
export class InvariantViolated extends AppError<{ invariant: string; detail: string }> {
  readonly _tag = "InvariantViolated" as const;

  constructor(props: { invariant: string; detail: string }) {
    super(`invariant "${props.invariant}" violated: ${props.detail}`, props);
  }
}

/** Union of every error this codebase raises deliberately. */
export type KnownError =
  | Forbidden
  | InvalidInput
  | InvariantViolated
  | NotFound
  | RateLimited
  | Transient
  | Unauthenticated
  | UpstreamError;

export function isAppError(value: unknown): value is AppError<object> {
  return value instanceof AppError;
}

/**
 * True when a failure means "we are broken" rather than "that didn't work".
 *
 * Defects belong in Sentry Issues; expected failures belong in metrics. The
 * legacy app blurred this and compensated with an
 * `ignoreErrors: ["LockContentionError", "DuplicateMessageError"]` denylist —
 * with tags the distinction is structural, so no denylist is needed.
 */
export function isDefect(value: unknown): boolean {
  if (value instanceof InvariantViolated) return true;
  if (value instanceof UnhandledException) return true;
  return !isAppError(value);
}

/** Retry only where a later attempt could plausibly differ. */
export function isRetryable(value: unknown): boolean {
  return value instanceof RateLimited || value instanceof Transient;
}

/** How long the error itself says to wait, when it knows. */
export function retryAfterMs(value: unknown): number | undefined {
  return value instanceof RateLimited ? value.props.retryAfterMs : undefined;
}

/**
 * Best-effort tag for any thrown value, for logging and metric dimensions.
 * Untagged values collapse to "Defect" so dashboards stay bounded.
 */
export function tagOf(value: unknown): string {
  if (TaggedError.isTaggedError(value)) return value._tag;
  return "Defect";
}

/** JSON-safe projection of any thrown value, tagged or not. */
export function serializeError(value: unknown): SerializedError {
  if (isAppError(value)) return value.toJSON();
  if (TaggedError.isTaggedError(value)) {
    return { _tag: value._tag, message: value.message, props: {} };
  }
  if (value instanceof Error) {
    return { _tag: "Defect", message: value.message, props: { name: value.name } };
  }
  return { _tag: "Defect", message: String(value), props: {} };
}
