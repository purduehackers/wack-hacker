/**
 * Result plumbing shared by both packages.
 *
 * better-result ships a deliberately small surface — `ok`, `err`, `try`,
 * `tryPromise`, `map`, `mapError`, `andThen`, `match`, `tap`, `unwrap`,
 * `unwrapOr`, `gen`, `await`, `hydrate`. Everything below is what this codebase
 * needs on top of it, and nothing more. Verified against better-result@1.0.1:
 * there is no `tapError`, `all`, or `partition` upstream, so they live here
 * rather than being imported and silently failing at runtime.
 */

import { Result as ResultOps } from "better-result";
import type { ResultType } from "better-result";

export { Err, Ok, TaggedError, UnhandledException } from "better-result";

/**
 * `Result` re-exported as both the value namespace and the type, so call sites
 * write `Result<T, E>` for the type and `Result.ok(…)` for the constructor.
 * better-result separates these into `Result` and `ResultType`; merging them
 * under one name here keeps every signature in the codebase readable.
 */
const Result = ResultOps;
type Result<T, E> = ResultType<T, E>;
export { Result };

/**
 * Runs a side effect on the error and returns the result untouched.
 *
 * This is the hook the observability layer attaches to; see `./observe`. It is
 * the error-side mirror of `Result.tap`, which better-result provides only for
 * the success side.
 */
export function tapError<T, E>(result: ResultType<T, E>, fn: (error: E) => void): ResultType<T, E> {
  if (Result.isError(result)) fn(result.error);
  return result;
}

/** Data-last form, for use in a pipeline. */
export function tapErrorWith<E>(fn: (error: E) => void) {
  return <T>(result: ResultType<T, E>): ResultType<T, E> => tapError(result, fn);
}

/**
 * All-or-nothing collection: the first error short-circuits.
 *
 * Use when partial success is meaningless — a batch of related writes that must
 * either all land or none. When each item stands alone, use `partition`.
 */
export function allOf<T, E>(results: readonly ResultType<T, E>[]): ResultType<readonly T[], E> {
  const values: T[] = [];
  for (const entry of results) {
    if (Result.isError(entry)) return Result.err(entry.error);
    values.push(entry.value);
  }
  return Result.ok(values);
}

export interface Partitioned<T, E> {
  readonly values: readonly T[];
  readonly errors: readonly E[];
}

/**
 * Processes every item and separates outcomes, discarding nothing.
 *
 * This replaces the legacy app's `Promise.allSettled` plus hand-rolled failure
 * counting — voice-transcription chunks that render `[part n/m failed]`
 * placeholders, conversation cleanup where only one of three deletes is
 * load-bearing, and the scheduled-task sweep that must not abort on one bad row.
 */
export function partition<T, E>(results: readonly ResultType<T, E>[]): Partitioned<T, E> {
  const values: T[] = [];
  const errors: E[] = [];
  for (const entry of results) {
    if (Result.isError(entry)) errors.push(entry.error);
    else values.push(entry.value);
  }
  return { values, errors };
}

/** `partition` over concurrent work. Never rejects: every outcome is captured. */
export async function partitionAsync<T, E>(
  results: readonly Promise<ResultType<T, E>>[],
): Promise<Partitioned<T, E>> {
  return partition(await Promise.all(results));
}

/**
 * Converts framework-mandated absence into a typed failure.
 *
 * eve hands back `null` in several places by contract — `ctx.session.auth
 * .current`, an `AuthFn` that declines, `Result.hydrate` on a non-Result. This
 * is the single conversion point so no `null` travels further into our code.
 */
export function fromNullable<T, E>(
  value: T | null | undefined,
  onAbsent: () => E,
): ResultType<T, E> {
  if (value === undefined) return Result.err(onAbsent());
  // oxlint-disable-next-line unicorn/no-null -- this function exists to absorb framework `null` at the boundary
  if (value === null) return Result.err(onAbsent());
  return Result.ok(value);
}
