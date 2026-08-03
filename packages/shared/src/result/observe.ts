/**
 * The observability seam.
 *
 * The point of adopting Result here is that error *reporting* stops being
 * something you have to remember. Wrap an operation once and every failure is
 * classified, counted, and — only when it is genuinely our bug — reported as an
 * issue. That replaces the legacy app's scattered
 * `logger.error(err)` → `captureException` → evlog chain, and preserves its one
 * good rule: exactly one reporting path, never a bare `captureException` next
 * to a `logger.error`, which double-reports.
 *
 * `Reporter` is an interface rather than a direct Sentry import so this package
 * stays dependency-light and each deployable chooses its own backend. The bot
 * wires it to `@sentry/bun`; the agent wires it to eve instrumentation.
 */

import { isDefect, serializeError, tagOf } from "../errors.ts";
import type { Result } from "./index.ts";
import { Result as ResultOps } from "./index.ts";

/** One wide event per unit of work, matching the legacy `evlog` discipline. */
export interface WideEvent {
  readonly op: string;
  readonly status: "ok" | "error" | "defect";
  readonly errorTag?: string;
  readonly errorMessage?: string;
  readonly durationMs?: number;
}

export interface Reporter {
  /** Emit the terminal wide event for a unit of work. */
  readonly emit: (event: WideEvent) => void;
  /** Report a genuine bug. Only ever called for defects. */
  readonly captureDefect: (error: unknown, context: { readonly op: string }) => void;
}

/** Discards everything. For code paths that must not report. */
export const silentReporter: Reporter = {
  emit: () => {},
  captureDefect: () => {},
};

/**
 * Classifies a failure and routes it, returning the result unchanged.
 *
 * An `AppError` is expected: it is counted as `status: "error"` and never
 * paged. A defect — a raw throw, better-result's `UnhandledException`, or an
 * `InvariantViolated` — is additionally captured as an issue.
 */
export function observe<T, E>(op: string, reporter: Reporter, result: Result<T, E>): Result<T, E> {
  return ResultOps.tapError(result, (error) => {
    const defect = isDefect(error);
    if (defect) reporter.captureDefect(error, { op });
    reporter.emit({
      op,
      status: defect ? "defect" : "error",
      errorTag: tagOf(error),
      errorMessage: serializeError(error).message,
    });
  });
}

/** Data-last form, for the end of a pipeline. */
export function observeWith(op: string, reporter: Reporter) {
  return <T, E>(result: Result<T, E>): Result<T, E> => observe(op, reporter, result);
}

/**
 * Wraps a unit of work so it emits exactly one wide event either way, with a
 * duration. `now` is injected so a caller can supply a monotonic clock.
 */
export async function instrument<T, E>(
  op: string,
  reporter: Reporter,
  work: () => Promise<Result<T, E>>,
  now: () => number = () => Date.now(),
): Promise<Result<T, E>> {
  const startedAt = now();
  const result = await work();
  const durationMs = now() - startedAt;

  if (result.status === "ok") {
    reporter.emit({ op, status: "ok", durationMs });
    return result;
  }

  const defect = isDefect(result.error);
  if (defect) reporter.captureDefect(result.error, { op });
  reporter.emit({
    op,
    status: defect ? "defect" : "error",
    errorTag: tagOf(result.error),
    errorMessage: serializeError(result.error).message,
    durationMs,
  });
  return result;
}
