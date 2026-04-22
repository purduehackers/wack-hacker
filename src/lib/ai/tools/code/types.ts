import type { Sandbox } from "@/lib/sandbox/types";

/**
 * Shape carried in `experimental_context` of the coding subagent's
 * `ToolLoopAgent.stream()` call. Constructed by
 * `delegates.ts::buildExperimentalContext` for the `code` domain.
 */
export interface CodingSandboxContext {
  sandbox: Sandbox;
  repo: string;
  branch: string;
  repoDir: string;
  threadKey: string;
}

/** Input parsed from the orchestrator's `delegate_code({ repo, task })` call. */
export interface CodeDelegationInput {
  repo: string;
  task: string;
}
