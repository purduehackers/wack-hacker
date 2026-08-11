import { defineState } from "eve/context";

import { assertStateValue } from "../../../lib/core/serialization.ts";

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
      /** Absolute checkout path in the sandbox this record was published from. */
      readonly repoDir: string;
    };

export const codeWorkspaceState = defineState<CodeWorkspaceState>("wack.code.workspace", () =>
  assertStateValue({ phase: "empty" }),
);
