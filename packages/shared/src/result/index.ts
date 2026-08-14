/**
 * Result plumbing shared by both packages.
 *
 * better-result 3 already provides everything this codebase needs —
 * `tapError`, `tapBoth`, `tryRecover`, `all`, `partition`, `flatten`, `codec`,
 * `gen`, and conditional retry on `tryPromise`. This module re-exports it and
 * adds the one helper upstream has no opinion on.
 *
 * Two things worth knowing about the upstream shape:
 *
 * - better-result exports `Result` as both a value and a type, so
 *   `Result<T, E>` and `Result.ok(…)` both work from a single import.
 * - `Result.partition` returns a **tuple** `[values, errors]`, not an object.
 */

import { Result } from "better-result";

export { Panic, panic, Result, TaggedError } from "better-result";

/**
 * Converts framework-mandated absence into a typed failure.
 *
 * eve hands back `null` by contract in several places — `ctx.session.auth
 * .current`, an `AuthFn` that declines, a dynamic resolver omitting a
 * capability. This is the single conversion point, so no `null` travels further
 * into our own code.
 */
export function fromNullable<T, E>(value: T | null | undefined, onAbsent: () => E): Result<T, E> {
  if (value === undefined) return Result.err(onAbsent());
  if (value === null) return Result.err(onAbsent());
  return Result.ok(value);
}
