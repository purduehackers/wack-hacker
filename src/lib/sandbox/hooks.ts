import { log } from "evlog";

import type { Sandbox, SandboxHooks, SandboxHooksConfig } from "./types.ts";

export type { SandboxHooksConfig } from "./types.ts";

/**
 * Build the `afterStart` / `beforeStop` hooks for a coding sandbox. Exposed
 * as a pure function so we can unit-test the install / clone / branch flow
 * against `InMemorySandbox` without actually provisioning a VM.
 *
 * `afterStart` order is load-bearing: toolchain (if not from a snapshot) →
 * git identity → clone → feature branch. Each step throws with the underlying
 * exit code + stderr on failure so the caller gets a useful error.
 */
export function buildSandboxHooks(config: SandboxHooksConfig): SandboxHooks {
  return {
    afterStart: async (sandbox) => {
      if (!config.hasBaseSnapshot) {
        await installToolchain(sandbox);
      }
      await configureGit(sandbox, config.gitUser);
      await cloneRepo(sandbox, config.repo, config.baseBranch);
      await createFeatureBranch(sandbox, config.branch);
    },
    beforeStop: async () => {
      log.info("sandbox", "beforeStop: sandbox shutting down");
    },
  };
}

async function run(sandbox: Sandbox, command: string, label: string): Promise<void> {
  const result = await sandbox.exec(command, { timeoutMs: 10 * 60 * 1000 });
  if (result.exitCode !== 0) {
    const snippet = (result.stderr || result.stdout).slice(0, 2000);
    throw new Error(`${label} failed (exit ${result.exitCode}): ${snippet}`);
  }
}

async function installToolchain(sandbox: Sandbox): Promise<void> {
  // node24 base image already has git + curl. Install ripgrep (used by grep
  // tool) and gh. bun is assumed preinstalled on the Vercel sandbox image.
  const script = [
    "set -e",
    "apt-get update",
    "apt-get install -y ripgrep",
    "type -p gh >/dev/null || (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg status=none && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' > /etc/apt/sources.list.d/github-cli.list && apt-get update && apt-get install -y gh)",
  ].join(" && ");
  await run(sandbox, script, "toolchain install");
}

async function configureGit(
  sandbox: Sandbox,
  user: { name: string; email: string },
): Promise<void> {
  await run(sandbox, `git config --global user.name ${JSON.stringify(user.name)}`, "git user.name");
  await run(
    sandbox,
    `git config --global user.email ${JSON.stringify(user.email)}`,
    "git user.email",
  );
}

async function cloneRepo(sandbox: Sandbox, repo: string, baseBranch?: string): Promise<void> {
  const url = `https://github.com/${repo}.git`;
  const revisionArg = baseBranch ? `--branch ${JSON.stringify(baseBranch)}` : "";
  // Clone into the working directory root. Network-policy brokering adds auth.
  await run(sandbox, `git clone ${revisionArg} ${JSON.stringify(url)} .`, `clone ${repo}`);
}

async function createFeatureBranch(sandbox: Sandbox, branch: string): Promise<void> {
  await run(sandbox, `git checkout -b ${JSON.stringify(branch)}`, `checkout -b ${branch}`);
}
