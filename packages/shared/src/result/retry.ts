/**
 * Retry policies.
 *
 * These are plain `Result.tryPromise` retry configs — better-result 3 drives the
 * attempt loop, the backoff curve, jitter, and abort handling. What belongs to
 * this codebase is only the *policy*: which failures are worth retrying, and how
 * long to wait when the error itself knows.
 *
 * `shouldRetry` defaults to always-retry upstream, which is wrong here.
 * Retrying a `NotFound` or an `InvalidInput` only multiplies latency and
 * upstream load for an outcome that cannot change, so every policy below sets it
 * explicitly.
 *
 * Together these replace the prior implementation's hand-rolled
 * `Math.min(300, 2 ** deliveryCount * 5)` backoff and its `eventRetryPolicy` /
 * task-retry directives, which keyed off a delivery counter that knew nothing
 * about the cause.
 */

import { isRetryable, retryAfterMs } from "../errors.ts";

/**
 * Mirrors better-result's `RetryConfig`, which the package declares but does not
 * export. Because the policies below are passed straight to
 * `Result.tryPromise`, an upstream shape change surfaces as a compile error at
 * the call site rather than drifting silently.
 */
export interface RetryPolicy<E> {
  /** Forwarded unchanged to every attempt and retry decision. */
  readonly signal?: AbortSignal;
  readonly retry?: {
    readonly times: number;
    /** Final delay for the next retry, in milliseconds. */
    readonly delayMs: (error: E, context: { readonly attempt: number }) => number;
    readonly shouldRetry?: (error: E, context: { readonly attempt: number }) => boolean;
  };
}

/**
 * Default for outbound calls to third-party services.
 *
 * `delayMs` is a function so an upstream-advised `retryAfterMs` wins over our
 * curve — a service telling us when to come back knows better than we do.
 * Dynamic delay cannot be combined with `backoff` or `jitter`, so the fallback
 * curve and its jitter are computed here.
 */
export const upstreamRetry: RetryPolicy<unknown> = {
  retry: {
    times: 2,
    shouldRetry: isRetryable,
    delayMs: (error, context) => retryAfterMs(error) ?? exponentialWithJitter(context.attempt),
  },
};

/** For work that is cheap to repeat and usually succeeds on the second try. */
export const quickRetry: RetryPolicy<unknown> = {
  retry: {
    times: 1,
    shouldRetry: isRetryable,
    delayMs: () => 50,
  },
};

/** Never retry. Explicit, so a call site that means it says so. */
export const noRetry: RetryPolicy<unknown> = {};

const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 5_000;

/**
 * Exponential backoff with full jitter, bounded by `MAX_DELAY_MS`.
 *
 * Full jitter — anywhere in `[0, capped]` — spreads a thundering herd better
 * than a narrow band around the target delay. `attempt` is 1-based.
 */
function exponentialWithJitter(attempt: number): number {
  const capped = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
  return Math.round(capped * Math.random());
}
