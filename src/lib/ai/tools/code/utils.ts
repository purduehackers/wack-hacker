import * as path from "node:path";

import type { CodingSandboxContext } from "./types.ts";

export type { CodingSandboxContext } from "./types.ts";

/**
 * Pull the sandbox context out of AI SDK's `experimental_context`. Throws a
 * loud error when missing — if a code tool was invoked without the context,
 * the delegation wiring is broken and we want a clear stack trace, not a
 * silent fallback.
 */
export function getSandboxContext(ctx: unknown, toolName: string): CodingSandboxContext {
  if (!ctx || typeof ctx !== "object" || !("sandbox" in ctx)) {
    throw new Error(
      `Tool "${toolName}" was invoked without a sandbox in experimental_context. ` +
        `This is a wiring bug — the code delegation should always inject { sandbox, repo, branch, repoDir, threadKey }.`,
    );
  }
  return ctx as CodingSandboxContext;
}

/**
 * Resolve a user-supplied path against the sandbox's repo dir and verify it
 * stays inside the repo. Accepts absolute paths (must start with repoDir)
 * and repo-relative paths.
 */
export function resolvePath(repoDir: string, userPath: string): string {
  const absolute = path.isAbsolute(userPath)
    ? path.normalize(userPath)
    : path.resolve(repoDir, userPath);

  const normalizedRoot = path.resolve(repoDir);
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}/`)) {
    throw new Error(
      `Path "${userPath}" resolves outside the repo directory (${normalizedRoot}); refusing.`,
    );
  }
  return absolute;
}

/** Format relative to repo for user-facing output — absolute paths are noisy in Discord. */
export function toRelative(repoDir: string, absolute: string): string {
  const rel = path.relative(repoDir, absolute);
  return rel === "" ? "." : rel;
}
