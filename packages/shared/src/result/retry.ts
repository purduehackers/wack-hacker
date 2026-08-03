/**
 * Conditional retry.
 *
 * better-result's built-in `retry` config (`{ times, delayMs, backoff }`) always
 * retries, whatever the failure. That is wrong for this codebase: retrying a
 * `NotFound` or an `InvalidInput` three times just multiplies latency and
 * upstream load for an outcome that cannot change. It also has no jitter, so
 * concurrent callers retry in lockstep.
 *
 * So attempts are driven here instead, with `shouldRetry` keyed on the error's
 * tag. This is the typed replacement for the legacy app's hand-rolled
 * `Math.min(300, 2 ** deliveryCount * 5)` backoff and its `eventRetryPolicy` /
 * task-retry directives — same shape, but the decision is now derived from the
 * error rather than from a delivery counter that knew nothing about the cause.
 */

import { isRetryable, retryAfterMs } from "../errors.ts";
import { Result } from "./index.ts";

export interface RetryPolicy {
  /** Total attempts, including the first. Must be at least 1. */
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly backoff: "constant" | "linear" | "exponential";
  /** Ceiling per wait, so exponential growth stays bounded. */
  readonly maxDelayMs: number;
  /** Randomize each wait to avoid synchronized retries. */
  readonly jitter: boolean;
  readonly shouldRetry: (error: unknown) => boolean;
}

/**
 * Default for outbound calls to third-party services. Retries only
 * `RateLimited` and `Transient`; everything else fails on the first attempt.
 */
export const upstreamPolicy: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 250,
  backoff: "exponential",
  maxDelayMs: 5_000,
  jitter: true,
  shouldRetry: isRetryable,
};

/** For work that is cheap to repeat and usually succeeds on the second try. */
export const quickPolicy: RetryPolicy = {
  attempts: 2,
  baseDelayMs: 50,
  backoff: "constant",
  maxDelayMs: 200,
  jitter: false,
  shouldRetry: isRetryable,
};

export function delayForAttempt(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  const growth =
    policy.backoff === "constant" ? 1 : policy.backoff === "linear" ? attempt + 1 : 2 ** attempt;
  const capped = Math.min(policy.baseDelayMs * growth, policy.maxDelayMs);
  // Full jitter: anywhere in [0, capped]. Spreads a thundering herd better than
  // a narrow band around the target delay.
  return policy.jitter ? Math.round(capped * random()) : capped;
}

export interface RetryDeps {
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

const defaultDeps: RetryDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

/**
 * Runs `work` until it succeeds, the policy declines to retry, or attempts run
 * out. Returns the last failure.
 *
 * `work` returns a `Result` rather than throwing, so a retry loop cannot
 * accidentally swallow a defect. If the error carries its own `retryAfterMs`
 * (as `RateLimited` does), that wins over the computed backoff — upstream knows
 * better than we do.
 *
 * `deps` is injected so tests neither sleep nor depend on `Math.random`.
 */
export async function retrying<T, E>(
  policy: RetryPolicy,
  work: (attempt: number) => Promise<Result<T, E>>,
  deps: RetryDeps = defaultDeps,
): Promise<Result<T, E>> {
  const budget = Math.max(1, policy.attempts);
  let last = await work(0);

  for (let attempt = 1; attempt < budget; attempt += 1) {
    if (last.status === "ok") return last;
    if (!policy.shouldRetry(last.error)) return last;

    const advised = retryAfterMs(last.error);
    const wait = advised ?? delayForAttempt(policy, attempt - 1, deps.random);
    await deps.sleep(wait);
    last = await work(attempt);
  }

  return last;
}

/**
 * Adapts a throwing async function into a retried `Result`. `catch` must map the
 * cause onto one of our tagged errors so `shouldRetry` has something to read —
 * an unmapped cause would arrive as `UnhandledException` and be treated,
 * correctly, as a non-retryable defect.
 */
export async function retryingPromise<T, E>(
  policy: RetryPolicy,
  options: { readonly try: () => Promise<T>; readonly catch: (cause: unknown) => E },
  deps: RetryDeps = defaultDeps,
): Promise<Result<T, E>> {
  return retrying(policy, () => Result.tryPromise(options), deps);
}
