import type { CreateCodingSandboxConfig, Sandbox } from "./types.ts";

import { buildSandboxHooks } from "./hooks.ts";
import { VercelSandbox } from "./vercel-sandbox.ts";

export type { CreateCodingSandboxConfig } from "./types.ts";

const DEFAULT_RUNTIME_ENV: Record<string, string> = {
  DEBIAN_FRONTEND: "noninteractive",
};

/** Dev-server ports we expose by default — same set open-agents uses. */
const DEFAULT_PREVIEW_PORTS = [3000, 5173, 4321, 8000];

/**
 * Create a sandbox provisioned for a coding task: toolchain installed, repo
 * cloned, feature branch checked out, git identity configured. Tokens never
 * land in the sandbox env — the network policy brokers auth for
 * `github.com` / `api.github.com` on every outbound request.
 */
export async function createCodingSandbox(config: CreateCodingSandboxConfig): Promise<Sandbox> {
  return VercelSandbox.create({
    githubToken: config.githubToken,
    baseSnapshotId: config.baseSnapshotId,
    timeoutMs: config.timeoutMs,
    env: DEFAULT_RUNTIME_ENV,
    ports: config.ports ?? DEFAULT_PREVIEW_PORTS,
    hooks: buildSandboxHooks({
      repo: config.repo,
      baseBranch: config.baseBranch,
      branch: config.branch,
      gitUser: config.gitUser,
      hasBaseSnapshot: Boolean(config.baseSnapshotId),
      skipCloneAndBranch: config.skipCloneAndBranch,
    }),
  });
}
