import type { SandboxSession } from "eve/sandbox";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { withGitHubPushCredentials } from "../../../lib/code-sandbox/network.ts";
import { codeMutationApproval, decideCodeCapability } from "../../../lib/code-sandbox/policy.ts";
import {
  CODE_GITHUB_OWNER,
  createCodePublicationRuntime,
  ensureCodePullRequest,
  featureBranchFor,
  isCodeRepositoryName,
} from "../../../lib/code-sandbox/publication.ts";
import {
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_MS,
  containsLikelySecret,
  isSensitivePath,
  runBoundedCommand,
  sanitizeText,
  shellQuote,
} from "../../../lib/code-sandbox/safety.ts";
import { codeWorkspaceState } from "../../../lib/code-sandbox/state.ts";
import { guardToolExecution } from "../../../lib/core/serialization.ts";

const postFinishInput = z.strictObject({
  commitMessage: z
    .string()
    .trim()
    .min(1)
    .max(72)
    .refine((value) => !value.includes("\n"), "Commit message must be one line."),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(12_000).optional(),
});

function failed(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

async function resetIndex(
  sandbox: SandboxSession,
  repoRoot: string,
  abortSignal: AbortSignal,
): Promise<void> {
  await runBoundedCommand({
    sandbox,
    command: "git reset --mixed --quiet",
    workingDirectory: repoRoot,
    timeoutMs: 10_000,
    maxOutputBytes: 1_000,
    abortSignal,
  });
}

/** The explicit last action: commit, push a deterministic branch, and open/reuse its PR. */
export default defineDynamic({
  events: {
    // oxlint-disable-next-line oxclippy/too-many-lines -- Eve requires the step-scoped dynamic definition beside its replay-safe executor.
    "step.started": (_event, resolveContext) => {
      const current = resolveContext.session.auth.current;
      const workspace = codeWorkspaceState.get();
      if (workspace.phase !== "ready") return undefined;
      const policy = decideCodeCapability(current, "code_post_finish", "destructive");
      if (!policy.allowed) return undefined;

      const boundRepo = workspace.repo;
      const boundRepoDir = workspace.repoDir;
      const checkoutSha = workspace.checkoutSha;
      const published = workspace.publication;

      return {
        code_post_finish: defineTool({
          description:
            "LAST TOOL ONLY. Commit verified workspace changes, push one deterministic feature branch through a temporary firewall credential broker, and open or reuse its pull request. Never call another tool after this succeeds. Requires current-admin self approval.",
          inputSchema: postFinishInput,
          approval: ({ session }) =>
            codeMutationApproval(session.auth.current, "code_post_finish", "destructive"),
          // oxlint-disable oxclippy/too-many-lines, oxclippy/cognitive-complexity -- publication stays inline for Eve replay reconstruction; SDK operations are factored into typed helpers.
          async execute({ commitMessage, title, body }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(
                ctx.session.auth.current,
                "code_post_finish",
                "destructive",
              );
              if (!permission.allowed) {
                return failed(
                  "policy_denied",
                  permission.reason ?? "Current-admin publication permission is required.",
                );
              }
              if (
                containsLikelySecret(commitMessage) ||
                containsLikelySecret(title) ||
                (body !== undefined && containsLikelySecret(body))
              ) {
                return failed(
                  "secret_input",
                  "Publication metadata containing likely secrets is refused.",
                );
              }
              if (published !== undefined) {
                return {
                  ok: true as const,
                  repo: boundRepo,
                  branch: published.branch,
                  commitSha: published.commitSha,
                  pullRequest: {
                    number: published.pullRequestNumber,
                    state: published.pullRequestState,
                    url: published.pullRequestUrl,
                    reused: true,
                  },
                  replayed: true,
                };
              }

              const [owner, repoName, extra] = boundRepo.split("/");
              if (
                owner !== CODE_GITHUB_OWNER ||
                repoName === undefined ||
                !isCodeRepositoryName(repoName) ||
                extra !== undefined
              ) {
                return failed(
                  "repo_not_allowed",
                  "Workspace is not bound to purduehackers/<repo>.",
                );
              }

              try {
                const publication = await createCodePublicationRuntime(repoName);
                const repository = await publication.client.rest.repos.get({
                  owner: CODE_GITHUB_OWNER,
                  repo: repoName,
                });
                if (repository.data.full_name.toLowerCase() !== boundRepo.toLowerCase()) {
                  return failed(
                    "repo_mismatch",
                    "GitHub repository does not match the bound workspace.",
                  );
                }
                if (repository.data.archived) {
                  return failed(
                    "repo_archived",
                    "Archived repositories cannot receive code publication.",
                  );
                }

                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(boundRepoDir);
                const canonicalOrigin = `https://github.com/${boundRepo}.git`;
                const topLevel = await runBoundedCommand({
                  sandbox,
                  command: "git rev-parse --show-toplevel",
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 2_000,
                  abortSignal: ctx.abortSignal,
                });
                if (topLevel.exitCode !== 0 || topLevel.stdout.trim() !== repoRoot) {
                  return failed(
                    "repo_mismatch",
                    "Sandbox Git root does not match the bound workspace.",
                  );
                }

                const remoteNames = await runBoundedCommand({
                  sandbox,
                  command: "git remote",
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 2_000,
                  abortSignal: ctx.abortSignal,
                });
                if (remoteNames.exitCode !== 0 || remoteNames.stdout.trim() !== "origin") {
                  return failed("remote_refused", "Only the bound origin remote is allowed.");
                }

                const remote = await runBoundedCommand({
                  sandbox,
                  command:
                    "git remote get-url --all origin && git remote get-url --push --all origin",
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 4_000,
                  abortSignal: ctx.abortSignal,
                });
                const remoteUrls = remote.stdout.trim().split("\n");
                if (
                  remote.exitCode !== 0 ||
                  remoteUrls.length !== 2 ||
                  remoteUrls.some((url) => url !== canonicalOrigin)
                ) {
                  return failed(
                    "remote_refused",
                    "Git remote is not the canonical bound repository URL.",
                  );
                }

                const unsafeConfig = await runBoundedCommand({
                  sandbox,
                  command:
                    "git config --get-regexp '^(url\\..*\\.(insteadOf|pushInsteadOf)|http\\..*|https\\..*|core\\.(gitProxy|sshCommand)|credential\\..*|remote\\..*\\.(pushurl|receivepack|uploadpack))$'",
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 4_000,
                  abortSignal: ctx.abortSignal,
                });
                if (unsafeConfig.exitCode === 0 || unsafeConfig.stdout.trim() !== "") {
                  return failed(
                    "git_config_refused",
                    "Git URL, proxy, credential, or transport overrides are refused.",
                  );
                }
                if (unsafeConfig.exitCode !== 1) {
                  return failed("git_config_failed", "Git configuration could not be validated.");
                }

                const branch = featureBranchFor(ctx.session.id, repoName);
                const branchRef = `refs/heads/${branch}`;
                const switchBranch = await runBoundedCommand({
                  sandbox,
                  command: `if git show-ref --verify --quiet ${shellQuote(branchRef)}; then git switch ${shellQuote(branch)}; else git switch -c ${shellQuote(branch)}; fi`,
                  workingDirectory: repoRoot,
                  timeoutMs: 30_000,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                if (switchBranch.exitCode !== 0) {
                  return failed(
                    "branch_failed",
                    "The deterministic feature branch could not be selected.",
                  );
                }

                const status = await runBoundedCommand({
                  sandbox,
                  command: "git status --porcelain=v1",
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                if (status.exitCode !== 0 || status.timedOut || status.outputLimited) {
                  return failed(
                    "status_failed",
                    "Git working-tree status could not be read safely.",
                  );
                }

                let committed = false;
                if (status.stdout.trim() !== "") {
                  const staged = await runBoundedCommand({
                    sandbox,
                    command: "git add -A -- .",
                    workingDirectory: repoRoot,
                    timeoutMs: 30_000,
                    maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                    abortSignal: ctx.abortSignal,
                  });
                  if (staged.exitCode !== 0 || staged.timedOut || staged.outputLimited) {
                    return failed("stage_failed", "Workspace changes could not be staged.");
                  }

                  const names = await runBoundedCommand({
                    sandbox,
                    command: "git diff --cached --name-only -z --",
                    workingDirectory: repoRoot,
                    timeoutMs: 30_000,
                    maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                    abortSignal: ctx.abortSignal,
                  });
                  const stagedPaths = names.stdout.split("\0").filter(Boolean);
                  if (
                    names.exitCode !== 0 ||
                    names.timedOut ||
                    names.outputLimited ||
                    stagedPaths.some(isSensitivePath)
                  ) {
                    await resetIndex(sandbox, repoRoot, ctx.abortSignal);
                    return failed(
                      "staged_paths_refused",
                      "Staged paths are invalid, too numerous, or secret-bearing.",
                    );
                  }

                  const diff = await runBoundedCommand({
                    sandbox,
                    command: "git diff --cached --no-ext-diff --no-color --binary --",
                    workingDirectory: repoRoot,
                    timeoutMs: 60_000,
                    maxOutputBytes: 512_000,
                    abortSignal: ctx.abortSignal,
                  });
                  if (diff.exitCode !== 0 || diff.timedOut || diff.outputLimited) {
                    await resetIndex(sandbox, repoRoot, ctx.abortSignal);
                    return failed(
                      "diff_refused",
                      "The staged diff exceeds safe inspection limits.",
                    );
                  }
                  if (containsLikelySecret(diff.stdout)) {
                    await resetIndex(sandbox, repoRoot, ctx.abortSignal);
                    return failed("secret_diff", "A likely secret was found in the staged diff.");
                  }

                  const commit = await runBoundedCommand({
                    sandbox,
                    command: `git -c core.hooksPath=/dev/null -c commit.gpgSign=false -c user.name='wack-hacker[bot]' -c user.email='bot@purduehackers.com' commit --no-verify -m ${shellQuote(commitMessage)}`,
                    workingDirectory: repoRoot,
                    timeoutMs: 60_000,
                    maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                    abortSignal: ctx.abortSignal,
                  });
                  if (commit.exitCode !== 0 || commit.timedOut || commit.outputLimited) {
                    const stderr = sanitizeText(commit.stderr, 2_000);
                    return {
                      ...failed("commit_failed", "The staged change could not be committed."),
                      stderr: stderr.text,
                      redacted: stderr.redacted,
                    };
                  }
                  committed = true;
                }

                const head = await runBoundedCommand({
                  sandbox,
                  command: "git rev-parse HEAD",
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 1_000,
                  abortSignal: ctx.abortSignal,
                });
                const commitSha = head.stdout.trim();
                if (head.exitCode !== 0 || !/^[a-f0-9]{40,64}$/u.test(commitSha)) {
                  return failed("head_failed", "Committed HEAD could not be verified.");
                }
                if (commitSha === checkoutSha) {
                  return failed("no_changes", "No changes exist beyond the original checkout.");
                }

                const ancestry = await runBoundedCommand({
                  sandbox,
                  command: `git merge-base --is-ancestor ${shellQuote(checkoutSha)} HEAD`,
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 1_000,
                  abortSignal: ctx.abortSignal,
                });
                if (ancestry.exitCode !== 0) {
                  return failed(
                    "history_refused",
                    "Published history must descend from the original checkout.",
                  );
                }

                const outgoingNames = await runBoundedCommand({
                  sandbox,
                  command: `git diff --name-only -z ${shellQuote(`${checkoutSha}..HEAD`)} --`,
                  workingDirectory: repoRoot,
                  timeoutMs: 30_000,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                const outgoingPaths = outgoingNames.stdout.split("\0").filter(Boolean);
                if (
                  outgoingNames.exitCode !== 0 ||
                  outgoingNames.timedOut ||
                  outgoingNames.outputLimited ||
                  outgoingPaths.some(isSensitivePath)
                ) {
                  return failed(
                    "outgoing_paths_refused",
                    "Outgoing paths are invalid, too numerous, or secret-bearing.",
                  );
                }

                const outgoingDiff = await runBoundedCommand({
                  sandbox,
                  command: `git diff --no-ext-diff --no-color --binary ${shellQuote(`${checkoutSha}..HEAD`)} --`,
                  workingDirectory: repoRoot,
                  timeoutMs: 60_000,
                  maxOutputBytes: 512_000,
                  abortSignal: ctx.abortSignal,
                });
                if (
                  outgoingDiff.exitCode !== 0 ||
                  outgoingDiff.timedOut ||
                  outgoingDiff.outputLimited
                ) {
                  return failed("outgoing_diff_refused", "The outgoing diff exceeds safe limits.");
                }
                if (
                  outgoingDiff.stdout.includes("GIT binary patch") ||
                  outgoingDiff.stdout.includes("Binary files")
                ) {
                  return failed(
                    "binary_diff_refused",
                    "Binary changes cannot be published safely.",
                  );
                }
                if (containsLikelySecret(outgoingDiff.stdout)) {
                  return failed("secret_diff", "A likely secret was found in the outgoing diff.");
                }

                const finalStatus = await runBoundedCommand({
                  sandbox,
                  command: "git status --porcelain=v1",
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                if (
                  finalStatus.exitCode !== 0 ||
                  finalStatus.timedOut ||
                  finalStatus.outputLimited ||
                  finalStatus.stdout.trim() !== ""
                ) {
                  return failed("workspace_not_clean", "The committed workspace is not clean.");
                }

                const push = await withGitHubPushCredentials(sandbox, publication.token, () =>
                  runBoundedCommand({
                    sandbox,
                    command: `git -c core.hooksPath=/dev/null -c credential.helper= push --porcelain --no-verify ${shellQuote(canonicalOrigin)} ${shellQuote(`${commitSha}:${branchRef}`)}`,
                    workingDirectory: repoRoot,
                    timeoutMs: MAX_COMMAND_TIMEOUT_MS,
                    maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                    abortSignal: ctx.abortSignal,
                  }),
                );
                if (push.exitCode !== 0 || push.timedOut || push.outputLimited) {
                  const stderr = sanitizeText(push.stderr, 2_000);
                  return {
                    ...failed(
                      "push_failed",
                      "The deterministic feature branch could not be pushed.",
                    ),
                    stderr: stderr.text,
                    redacted: stderr.redacted,
                  };
                }

                const pullRequest = await ensureCodePullRequest(publication.client.rest.pulls, {
                  repoName,
                  branch,
                  base: repository.data.default_branch,
                  title,
                  ...(body === undefined ? {} : { body }),
                });
                codeWorkspaceState.update((state) =>
                  state.phase === "ready" && state.repo === boundRepo
                    ? {
                        ...state,
                        publication: {
                          branch,
                          commitSha,
                          pullRequestNumber: pullRequest.number,
                          pullRequestState: pullRequest.state,
                          pullRequestUrl: pullRequest.url,
                        },
                      }
                    : state,
                );
                return {
                  ok: true as const,
                  repo: boundRepo,
                  branch,
                  commitSha,
                  committed,
                  pushed: true,
                  pullRequest,
                  replayed: false,
                };
              } catch {
                return failed(
                  "publication_failed",
                  "Code publication failed without exposing credentials; retrying is safe.",
                );
              }
            });
          },
          // oxlint-enable oxclippy/too-many-lines, oxclippy/cognitive-complexity
        }),
      };
    },
  },
});
