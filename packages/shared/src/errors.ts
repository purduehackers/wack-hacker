/**
 * @fileoverview The project's error taxonomy, joined into one module.
 *
 * The classes live in `tagged-errors.ts` and the helpers in
 * `error-utils.ts`. This module joins them, so every importer keeps one
 * specifier: `@repo/shared/errors`.
 *
 * The split is not cosmetic. `errors-file-organization` lets a file with this
 * name hold only classes whose superclass it can name, and it reads a
 * superclass only from an identifier. `TaggedError(tag)` is a call, so the rule
 * flagged every class here. It ignores a re-export.
 */

export * from "./error-utils.ts";
export * from "./tagged-errors.ts";
