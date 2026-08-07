import { createHash } from "node:crypto";

import { defineState } from "eve/context";
import type { SandboxSession } from "eve/sandbox";

import { assertStateValue } from "../core/serialization.ts";

export interface CodePublicationState {
  readonly branch: string;
  readonly commitSha: string;
  readonly pullRequestNumber: number;
  readonly pullRequestState: string;
  readonly pullRequestUrl: string;
}

/** Durable state owned by one delegated code session. */
export type CodeWorkspaceState =
  | { readonly phase: "empty" }
  | {
      readonly phase: "ready";
      /** Commit originally checked out, used as the replay-safe no-change base. */
      readonly checkoutSha: string;
      readonly publication?: CodePublicationState;
      readonly repo: string;
      /** Sandbox-relative directory below `/workspace`. */
      readonly repoDir: string;
    };

/** Minimal session identity derived from Eve's sandbox contract. */
export type SandboxIdentity = Pick<SandboxSession, "id">;

/**
 * Defense-in-depth namespace below `/workspace` for a single Eve sandbox
 * session. Eve already provisions one sandbox per durable session; keeping the
 * checkout in a stable, opaque namespace also prevents accidental sharing by a
 * custom backend or future bootstrap cache.
 */
export function codeSessionDirectory(sandbox: SandboxIdentity): string {
  if (sandbox.id === "") throw new Error("Eve sandbox session id is empty.");
  const key = createHash("sha256").update(sandbox.id).digest("hex").slice(0, 24);
  return `sessions/${key}`;
}

export const codeWorkspaceState = defineState<CodeWorkspaceState>("wack.code.workspace", () =>
  assertStateValue({ phase: "empty" }),
);
