import type { SessionAuthContext } from "eve/context";
import type { SandboxSession } from "eve/sandbox";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { guardToolExecution } from "../../../lib/serialization.ts";
import {
  CodeHarnessSandboxLost,
  attachParkedCodeHarnessSandbox,
  codeHarnessPublicationTarget,
  type AttachedCodeHarnessSandbox,
} from "../lib/harness.ts";
import { withGitHubPushCredentials } from "../lib/network.ts";
import { codeMutationApproval, decideCodeCapability } from "../lib/policy.ts";
import {
  CODE_GITHUB_OWNER,
  createCodePublicationRuntime,
  ensureCodePullRequest,
  featureBranchFor,
  isCodeRepositoryName,
} from "../lib/publication.ts";
import {
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_MS,
  containsLikelySecret,
  isSensitivePath,
  runBoundedCommand,
  sanitizeText,
  shellQuote,
  type SandboxCommandRunner,
} from "../lib/safety.ts";
import { codeWorkspaceState, type CodePublicationState } from "../lib/state.ts";

/** A commit subject or PR title: one line, checked after the surrounding trim. */
const singleLine = z.stringFormat("single-line", /^[^\n]*$/u);
/** A full or abbreviated-to-40 git object id, as `git rev-parse` prints it. */
const gitObjectId = z.stringFormat("git-object-id", /^[a-f0-9]{40,64}$/u);

const postFinishInput = z.strictObject({
  commitMessage: z.string().trim().min(1).max(72).check(singleLine),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(12_000).optional(),
});

function failed(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

/**
 * A missing checkout is reported verbatim rather than folded into the generic
 * publication failure: "the edits are gone, redo the work" and "publication
 * failed, retrying is safe" call for opposite operator moves.
 */
function attachmentFailure(cause: unknown) {
  if (CodeHarnessSandboxLost.is(cause)) return failed("harness_sandbox_lost", cause.message);
  return failed("harness_attach_failed", "The parked checkout could not be resolved to publish.");
}

/** The one sandbox and checkout every publication command runs against. */
interface PublicationExec {
  readonly abortSignal: AbortSignal;
  readonly repoRoot: string;
  readonly sandbox: SandboxCommandRunner;
}

function runPublicationCommand(
  exec: PublicationExec,
  command: string,
  limits: { readonly maxOutputBytes: number; readonly timeoutMs: number },
) {
  return runBoundedCommand({
    sandbox: exec.sandbox,
    command,
    workingDirectory: exec.repoRoot,
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    abortSignal: exec.abortSignal,
  });
}

async function resetIndex(exec: PublicationExec): Promise<void> {
  await runPublicationCommand(exec, "git reset --mixed --quiet", {
    timeoutMs: 10_000,
    maxOutputBytes: 1_000,
  });
}

/**
 * Re-proves, at publication time, that the sandbox still holds the parked
 * checkout behind a single canonical origin and that no git configuration can
 * redirect the push or inject a credential.
 */
async function remoteSafetyFailure(exec: PublicationExec, canonicalOrigin: string) {
  const topLevel = await runPublicationCommand(exec, "git rev-parse --show-toplevel", {
    timeoutMs: 10_000,
    maxOutputBytes: 2_000,
  });
  if (topLevel.exitCode !== 0 || topLevel.stdout.trim() !== exec.repoRoot) {
    return failed("repo_mismatch", "The sandbox no longer holds the checkout that was parked.");
  }

  const remoteNames = await runPublicationCommand(exec, "git remote", {
    timeoutMs: 10_000,
    maxOutputBytes: 2_000,
  });
  if (remoteNames.exitCode !== 0 || remoteNames.stdout.trim() !== "origin") {
    return failed("remote_refused", "Only the bound origin remote is allowed.");
  }

  const remote = await runPublicationCommand(
    exec,
    "git remote get-url --all origin && git remote get-url --push --all origin",
    { timeoutMs: 10_000, maxOutputBytes: 4_000 },
  );
  const remoteUrls = remote.stdout.trim().split("\n");
  if (
    remote.exitCode !== 0 ||
    remoteUrls.length !== 2 ||
    remoteUrls.some((url) => url !== canonicalOrigin)
  ) {
    return failed("remote_refused", "Git remote is not the canonical bound repository URL.");
  }

  const unsafeConfig = await runPublicationCommand(
    exec,
    "git config --get-regexp '^(url\\..*\\.(insteadOf|pushInsteadOf)|http\\..*|https\\..*|core\\.(gitProxy|sshCommand)|credential\\..*|remote\\..*\\.(pushurl|receivepack|uploadpack))$'",
    { timeoutMs: 10_000, maxOutputBytes: 4_000 },
  );
  if (unsafeConfig.exitCode === 0 || unsafeConfig.stdout.trim() !== "") {
    return failed(
      "git_config_refused",
      "Git URL, proxy, credential, or transport overrides are refused.",
    );
  }
  if (unsafeConfig.exitCode !== 1) {
    return failed("git_config_failed", "Git configuration could not be validated.");
  }
  return undefined;
}

/** Selects the deterministic feature branch, creating it only when absent. */
async function selectBranchFailure(exec: PublicationExec, branch: string, branchRef: string) {
  const switchBranch = await runPublicationCommand(
    exec,
    `if git show-ref --verify --quiet ${shellQuote(branchRef)}; then git switch ${shellQuote(branch)}; else git switch -c ${shellQuote(branch)}; fi`,
    { timeoutMs: 30_000, maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES },
  );
  if (switchBranch.exitCode !== 0) {
    return failed("branch_failed", "The deterministic feature branch could not be selected.");
  }
  return undefined;
}

/**
 * Stages, scans, and commits the working tree, unstaging again whenever the
 * scan refuses what it found so the sandbox is never left with a poisoned index.
 */
async function commitWorkspace(exec: PublicationExec, commitMessage: string) {
  const status = await runPublicationCommand(exec, "git status --porcelain=v1", {
    timeoutMs: 10_000,
    maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
  });
  if (status.exitCode !== 0 || status.timedOut || status.outputLimited) {
    return failed("status_failed", "Git working-tree status could not be read safely.");
  }

  if (status.stdout.trim() !== "") {
    const staged = await runPublicationCommand(exec, "git add -A -- .", {
      timeoutMs: 30_000,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
    });
    if (staged.exitCode !== 0 || staged.timedOut || staged.outputLimited) {
      return failed("stage_failed", "Workspace changes could not be staged.");
    }

    const names = await runPublicationCommand(exec, "git diff --cached --name-only -z --", {
      timeoutMs: 30_000,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
    });
    const stagedPaths = names.stdout.split("\0").filter(Boolean);
    if (
      names.exitCode !== 0 ||
      names.timedOut ||
      names.outputLimited ||
      stagedPaths.some(isSensitivePath)
    ) {
      await resetIndex(exec);
      return failed(
        "staged_paths_refused",
        "Staged paths are invalid, too numerous, or secret-bearing.",
      );
    }

    const diff = await runPublicationCommand(
      exec,
      "git diff --cached --no-ext-diff --no-color --binary --",
      { timeoutMs: 60_000, maxOutputBytes: 512_000 },
    );
    if (diff.exitCode !== 0 || diff.timedOut || diff.outputLimited) {
      await resetIndex(exec);
      return failed("diff_refused", "The staged diff exceeds safe inspection limits.");
    }
    if (containsLikelySecret(diff.stdout)) {
      await resetIndex(exec);
      return failed("secret_diff", "A likely secret was found in the staged diff.");
    }

    const commit = await runPublicationCommand(
      exec,
      `git -c core.hooksPath=/dev/null -c commit.gpgSign=false -c user.name='wack-hacker[bot]' -c user.email='bot@purduehackers.com' commit --no-verify -m ${shellQuote(commitMessage)}`,
      { timeoutMs: 60_000, maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES },
    );
    if (commit.exitCode !== 0 || commit.timedOut || commit.outputLimited) {
      const stderr = sanitizeText(commit.stderr, 2_000);
      return {
        ...failed("commit_failed", "The staged change could not be committed."),
        stderr: stderr.text,
        redacted: stderr.redacted,
      };
    }
    return { ok: true as const, committed: true };
  }
  return { ok: true as const, committed: false };
}

/** HEAD after committing, proven to be a real commit past the original base. */
async function resolveHeadCommit(exec: PublicationExec, checkoutSha: string) {
  const head = await runPublicationCommand(exec, "git rev-parse HEAD", {
    timeoutMs: 10_000,
    maxOutputBytes: 1_000,
  });
  const commitSha = head.stdout.trim();
  if (head.exitCode !== 0 || !gitObjectId.safeParse(commitSha).success) {
    return failed("head_failed", "Committed HEAD could not be verified.");
  }
  if (commitSha === checkoutSha) {
    return failed("no_changes", "No changes exist beyond the original checkout.");
  }
  return { ok: true as const, commitSha };
}

/** Everything the push would carry, re-scanned against the original checkout. */
async function outgoingFailure(exec: PublicationExec, checkoutSha: string) {
  const ancestry = await runPublicationCommand(
    exec,
    `git merge-base --is-ancestor ${shellQuote(checkoutSha)} HEAD`,
    { timeoutMs: 10_000, maxOutputBytes: 1_000 },
  );
  if (ancestry.exitCode !== 0) {
    return failed("history_refused", "Published history must descend from the original checkout.");
  }

  const outgoingNames = await runPublicationCommand(
    exec,
    `git diff --name-only -z ${shellQuote(`${checkoutSha}..HEAD`)} --`,
    { timeoutMs: 30_000, maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES },
  );
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

  const outgoingDiff = await runPublicationCommand(
    exec,
    `git diff --no-ext-diff --no-color --binary ${shellQuote(`${checkoutSha}..HEAD`)} --`,
    { timeoutMs: 60_000, maxOutputBytes: 512_000 },
  );
  if (outgoingDiff.exitCode !== 0 || outgoingDiff.timedOut || outgoingDiff.outputLimited) {
    return failed("outgoing_diff_refused", "The outgoing diff exceeds safe limits.");
  }
  if (
    outgoingDiff.stdout.includes("GIT binary patch") ||
    outgoingDiff.stdout.includes("Binary files")
  ) {
    return failed("binary_diff_refused", "Binary changes cannot be published safely.");
  }
  if (containsLikelySecret(outgoingDiff.stdout)) {
    return failed("secret_diff", "A likely secret was found in the outgoing diff.");
  }

  const finalStatus = await runPublicationCommand(exec, "git status --porcelain=v1", {
    timeoutMs: 10_000,
    maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
  });
  if (
    finalStatus.exitCode !== 0 ||
    finalStatus.timedOut ||
    finalStatus.outputLimited ||
    finalStatus.stdout.trim() !== ""
  ) {
    return failed("workspace_not_clean", "The committed workspace is not clean.");
  }
  return undefined;
}

/**
 * The token stays in this process: the firewall injects the Authorization
 * header, and git inside the sandbox never sees it. The broker restores the
 * sandbox's normal egress on both the success and the failure path.
 */
async function pushFailure(input: {
  readonly attached: AttachedCodeHarnessSandbox;
  readonly branchRef: string;
  readonly canonicalOrigin: string;
  readonly commitSha: string;
  readonly exec: PublicationExec;
  readonly token: string;
}) {
  const push = await withGitHubPushCredentials(input.attached.network, input.token, () =>
    runPublicationCommand(
      input.exec,
      // GIT_TERMINAL_PROMPT=0 turns a rejected credential into an immediate
      // failure. Without it git falls back to prompting, and only the absence
      // of a tty in the sandbox stops it from hanging until the timeout.
      `GIT_TERMINAL_PROMPT=0 git -c core.hooksPath=/dev/null -c credential.helper= push --porcelain --no-verify ${shellQuote(input.canonicalOrigin)} ${shellQuote(`${input.commitSha}:${input.branchRef}`)}`,
      { timeoutMs: MAX_COMMAND_TIMEOUT_MS, maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES },
    ),
  );
  if (push.exitCode !== 0 || push.timedOut || push.outputLimited) {
    const stderr = sanitizeText(push.stderr, 2_000);
    return {
      ...failed("push_failed", "The deterministic feature branch could not be pushed."),
      stderr: stderr.text,
      redacted: stderr.redacted,
    };
  }
  return undefined;
}

/** Commit, push, and open or reuse the pull request for a reattached sandbox. */
async function publishAttachedCheckout(input: {
  readonly abortSignal: AbortSignal;
  readonly attached: AttachedCodeHarnessSandbox;
  readonly body: string | undefined;
  readonly boundRepo: string;
  readonly checkoutSha: string;
  readonly commitMessage: string;
  readonly repoName: string;
  readonly sessionId: string;
  readonly title: string;
}) {
  const publication = await createCodePublicationRuntime(input.repoName);
  const repository = await publication.client.rest.repos.get({
    owner: CODE_GITHUB_OWNER,
    repo: input.repoName,
  });
  if (repository.data.full_name.toLowerCase() !== input.boundRepo.toLowerCase()) {
    return failed(
      "repo_mismatch",
      "GitHub repository does not match the repository the sandbox is bound to.",
    );
  }
  if (repository.data.archived) {
    return failed("repo_archived", "Archived repositories cannot receive code publication.");
  }

  const exec: PublicationExec = {
    abortSignal: input.abortSignal,
    repoRoot: input.attached.repoRoot,
    sandbox: input.attached.exec,
  };
  const canonicalOrigin = `https://github.com/${input.boundRepo}.git`;
  const remoteFailure = await remoteSafetyFailure(exec, canonicalOrigin);
  if (remoteFailure !== undefined) return remoteFailure;

  const branch = featureBranchFor(input.sessionId, input.repoName);
  const branchRef = `refs/heads/${branch}`;
  const branchFailure = await selectBranchFailure(exec, branch, branchRef);
  if (branchFailure !== undefined) return branchFailure;

  const commitResult = await commitWorkspace(exec, input.commitMessage);
  if (!commitResult.ok) return commitResult;
  const headResult = await resolveHeadCommit(exec, input.checkoutSha);
  if (!headResult.ok) return headResult;
  const outgoingRefusal = await outgoingFailure(exec, input.checkoutSha);
  if (outgoingRefusal !== undefined) return outgoingRefusal;

  const pushRefusal = await pushFailure({
    attached: input.attached,
    branchRef,
    canonicalOrigin,
    commitSha: headResult.commitSha,
    exec,
    token: publication.token,
  });
  if (pushRefusal !== undefined) return pushRefusal;

  const pullRequest = await ensureCodePullRequest(publication.client.rest.pulls, {
    repoName: input.repoName,
    branch,
    base: repository.data.default_branch,
    title: input.title,
    ...(input.body === undefined ? {} : { body: input.body }),
  });
  // The published record, not a workspace handle: it is what makes publication
  // terminal for this delegated session and what a replay of this step answers
  // from instead of pushing a second time.
  codeWorkspaceState.update(() => ({
    phase: "ready",
    checkoutSha: input.checkoutSha,
    repo: input.boundRepo,
    repoDir: exec.repoRoot,
    publication: {
      branch,
      commitSha: headResult.commitSha,
      pullRequestNumber: pullRequest.number,
      pullRequestState: pullRequest.state,
      pullRequestUrl: pullRequest.url,
    },
  }));
  return {
    ok: true as const,
    repo: input.boundRepo,
    branch,
    commitSha: headResult.commitSha,
    committed: commitResult.committed,
    pushed: true,
    pullRequest,
    replayed: false,
  };
}

/**
 * The executor body of `code_post_finish`, from re-checking policy through to
 * the published record. It lives beside the tool rather than inside it so the
 * step-scoped definition stays small; the replay-safe decisions (the already
 * published record, the bound repository, the base commit) are all passed in
 * from the closure Eve reconstructs, not re-read here.
 */
async function runCodePublication(input: {
  readonly abortSignal: AbortSignal;
  readonly body: string | undefined;
  readonly boundRepo: string;
  readonly checkoutSha: string;
  readonly commitMessage: string;
  readonly current: SessionAuthContext | null;
  readonly published: CodePublicationState | undefined;
  /** This session's sandbox — the one `code_task` left its checkout in. */
  readonly sandbox: SandboxSession;
  readonly sessionId: string;
  readonly title: string;
}) {
  const permission = decideCodeCapability(input.current, "code_post_finish", "destructive");
  if (!permission.allowed) {
    return failed(
      "policy_denied",
      permission.reason ?? "Current-admin publication permission is required.",
    );
  }
  if (
    containsLikelySecret(input.commitMessage) ||
    containsLikelySecret(input.title) ||
    (input.body !== undefined && containsLikelySecret(input.body))
  ) {
    return failed("secret_input", "Publication metadata containing likely secrets is refused.");
  }
  if (input.published !== undefined) {
    return {
      ok: true as const,
      repo: input.boundRepo,
      branch: input.published.branch,
      commitSha: input.published.commitSha,
      pullRequest: {
        number: input.published.pullRequestNumber,
        state: input.published.pullRequestState,
        url: input.published.pullRequestUrl,
        reused: true,
      },
      replayed: true,
    };
  }

  const [owner, repoName, extra] = input.boundRepo.split("/");
  if (
    owner !== CODE_GITHUB_OWNER ||
    repoName === undefined ||
    !isCodeRepositoryName(repoName) ||
    extra !== undefined
  ) {
    return failed("repo_not_allowed", "The parked checkout is not bound to purduehackers/<repo>.");
  }

  // Outside the catch below: a missing checkout is already typed and must not
  // be flattened into "retrying is safe".
  let attached: AttachedCodeHarnessSandbox;
  try {
    attached = await attachParkedCodeHarnessSandbox({
      abortSignal: input.abortSignal,
      sandbox: input.sandbox,
    });
  } catch (cause) {
    return attachmentFailure(cause);
  }
  if (attached.repo !== input.boundRepo) {
    return failed("repo_mismatch", "The parked checkout is for a different repository.");
  }

  try {
    return await publishAttachedCheckout({
      abortSignal: input.abortSignal,
      attached,
      body: input.body,
      boundRepo: input.boundRepo,
      checkoutSha: input.checkoutSha,
      commitMessage: input.commitMessage,
      repoName,
      sessionId: input.sessionId,
      title: input.title,
    });
  } catch {
    return failed(
      "publication_failed",
      "Code publication failed without exposing credentials; retrying is safe.",
    );
  }
}

/** The explicit last action: commit, push a deterministic branch, and open/reuse its PR. */
export default defineDynamic({
  events: {
    "step.started": (_event, resolveContext) => {
      const current = resolveContext.session.auth.current;
      // Publication is bound to the sandbox `code_task` parked. With nothing
      // parked there is no checkout to publish, so the tool does not exist.
      const target = codeHarnessPublicationTarget();
      if (target === undefined) return undefined;
      const policy = decideCodeCapability(current, "code_post_finish", "destructive");
      if (!policy.allowed) return undefined;

      const boundRepo = target.repo;
      const checkoutSha = target.checkoutSha;
      const workspace = codeWorkspaceState.get();
      const published =
        workspace.phase === "ready" && workspace.repo === boundRepo
          ? workspace.publication
          : undefined;

      return {
        code_post_finish: defineTool({
          description:
            "LAST TOOL ONLY. Commit the changes code_task made in its Codex sandbox, push one deterministic feature branch through a temporary firewall credential broker, and open or reuse its pull request. Never call another tool after this succeeds. Requires current-admin self approval.",
          inputSchema: postFinishInput,
          approval: ({ session }) =>
            codeMutationApproval(session.auth.current, "code_post_finish", "destructive"),
          async execute({ commitMessage, title, body }, ctx) {
            return guardToolExecution(async () =>
              runCodePublication({
                abortSignal: ctx.abortSignal,
                body,
                boundRepo,
                checkoutSha,
                commitMessage,
                current: ctx.session.auth.current,
                published,
                sandbox: await ctx.getSandbox(),
                sessionId: ctx.session.id,
                title,
              }),
            );
          },
        }),
      };
    },
  },
});
