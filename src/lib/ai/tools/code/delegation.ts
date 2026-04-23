import type { UIMessage } from "ai";

import { z } from "zod";

import type { Sandbox } from "@/lib/sandbox/types";

import { createWideLogger } from "@/lib/logging/wide";
import { countMetric } from "@/lib/metrics";
import { getOrCreateSession } from "@/lib/sandbox/session";

import type { AgentContext } from "../../context.ts";
import type { CodingSandboxContext } from "./utils.ts";

import { env } from "../../../../env.ts";
import { octokit } from "../github/client.ts";

/**
 * Matches exactly two slash-separated segments where the owner is the
 * configured GitHub org and the repo name is a single valid path segment
 * (alphanumeric, dot, hyphen, underscore). Prevents values like
 * `purduehackers/repo/extra` or `purduehackers//x`.
 */
const repoPattern = new RegExp(`^${escapeRegExp(env.GITHUB_ORG)}/[A-Za-z0-9._-]+$`);

/** Input schema for `delegate_code`. */
export const codeDelegationInputSchema = z.object({
  repo: z
    .string()
    .regex(
      repoPattern,
      `Repo must be \`${env.GITHUB_ORG}/<name>\` — exactly two path segments, no extra slashes.`,
    )
    .describe(
      `Target repository in the \`${env.GITHUB_ORG}/<name>\` form. Refused if outside the org.`,
    ),
  task: z.string().describe("The user's task, forwarded verbatim to the coding subagent"),
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type { CodeDelegationInput } from "./types.ts";

const GIT_USER = {
  name: "wack-hacker[bot]",
  email: "bot@purduehackers.com",
};

export async function buildCodeExperimentalContext(
  input: unknown,
  agentContext: AgentContext,
): Promise<CodingSandboxContext> {
  // `codeDelegationInputSchema` already enforces the `${env.GITHUB_ORG}/<name>`
  // shape via regex; `parse` surfaces any malformed input with a clear error.
  const parsed = codeDelegationInputSchema.parse(input);

  const threadKey = agentContext.thread?.id ?? agentContext.channel.id;
  const installationToken = await mintInstallationToken();

  const session = await getOrCreateSession({
    threadKey,
    repo: parsed.repo,
    githubToken: installationToken,
    gitUser: GIT_USER,
    baseSnapshotId: env.SANDBOX_BASE_SNAPSHOT_ID,
  });

  return {
    sandbox: session.sandbox,
    repo: parsed.repo,
    branch: session.metadata.branch,
    repoDir: session.metadata.repoDir,
    threadKey,
  };
}

/**
 * Post-finish: if the coding subagent left uncommitted changes on its branch,
 * commit them, push, and open (or leave alone) a PR. Yields a final
 * `UIMessage` so the PR URL shows up as the subagent's last visible output.
 */
export async function* codePostFinish(args: {
  input?: unknown;
  agentContext?: unknown;
  experimentalContext: unknown;
  lastAssistantText: string;
}): AsyncGenerator<UIMessage, void, void> {
  const ctx = args.experimentalContext as CodingSandboxContext | undefined;
  if (!ctx) {
    createWideLogger({ op: "ai.code_delegate.post_finish" }).emit({
      outcome: "skipped",
      reason: "no_experimental_context",
    });
    return;
  }
  const authorUsername = (args.agentContext as AgentContext | undefined)?.username;
  const { sandbox, repo, branch } = ctx;
  const logger = createWideLogger({
    op: "ai.code_delegate.post_finish",
    code_delegate: { repo, branch, thread_key: ctx.threadKey },
  });

  const status = await sandbox.exec("git status --porcelain", { cwd: ctx.repoDir });
  if (status.exitCode !== 0) {
    logger.emit({ outcome: "aborted", reason: "git_status_failed", exit_code: status.exitCode });
    yield statusMessage(
      `Post-finish aborted: \`git status\` exited ${status.exitCode}. stderr: ${truncate(status.stderr)}`,
    );
    return;
  }
  if (!status.stdout.trim()) {
    logger.emit({ outcome: "no_changes" });
    yield statusMessage("No changes to commit. Nothing pushed; no PR opened.");
    return;
  }

  const commitMessage = extractCommitMessage(args.lastAssistantText);

  const addResult = await sandbox.exec("git add -A", { cwd: ctx.repoDir });
  if (addResult.exitCode !== 0) {
    logger.emit({ outcome: "staging_failed", exit_code: addResult.exitCode });
    yield statusMessage(
      `Staging failed (exit ${addResult.exitCode}). stderr: ${truncate(addResult.stderr || addResult.stdout)}`,
    );
    return;
  }

  const commitResult = await sandbox.exec(`git commit -m ${shellQuote(commitMessage)}`, {
    cwd: ctx.repoDir,
  });
  if (commitResult.exitCode !== 0) {
    logger.emit({ outcome: "commit_failed", exit_code: commitResult.exitCode });
    yield statusMessage(
      `Commit failed (exit ${commitResult.exitCode}). stderr: ${truncate(commitResult.stderr || commitResult.stdout)}`,
    );
    return;
  }

  const push = await sandbox.exec(`git push -u origin ${shellQuote(branch)}`, {
    cwd: ctx.repoDir,
    timeoutMs: 3 * 60 * 1000,
  });
  if (push.exitCode !== 0) {
    logger.emit({ outcome: "push_failed", exit_code: push.exitCode });
    yield statusMessage(
      `Push failed (exit ${push.exitCode}). stderr: ${truncate(push.stderr || push.stdout)}`,
    );
    return;
  }

  let prUrl: string;
  try {
    prUrl = await ensurePullRequest({
      repo,
      branch,
      title: commitMessage,
      body: buildPrBody(args.lastAssistantText, authorUsername),
      sandbox,
      repoDir: ctx.repoDir,
    });
  } catch (err) {
    logger.error(err as Error);
    logger.emit({ outcome: "pr_open_failed" });
    yield statusMessage(
      `Branch \`${branch}\` pushed but opening the PR failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  countMetric("ai.code_delegate.pr_opened");
  logger.emit({ outcome: "pr_opened", pr_url: prUrl });
  yield statusMessage(`${args.lastAssistantText.trim()}\n\n**PR**: ${prUrl}`.trim());
}

async function mintInstallationToken(): Promise<string> {
  // octokit created with App auth in src/lib/ai/tools/github/client.ts; grab an
  // installation token scoped to the GitHub App's installation. We use Octokit's
  // built-in `auth()` which returns an InstallationAccessToken when passed a type.
  const authed = (await octokit.auth({ type: "installation" })) as { token?: string };
  if (!authed?.token) {
    throw new Error("Failed to mint GitHub App installation token for sandbox network policy");
  }
  return authed.token;
}

async function ensurePullRequest(args: {
  repo: string;
  branch: string;
  title: string;
  body: string;
  sandbox: Sandbox;
  repoDir: string;
}): Promise<string> {
  const [owner, name] = args.repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo string: ${args.repo}`);

  const repoMeta = await octokit.rest.repos.get({ owner, repo: name });
  const base = repoMeta.data.default_branch;

  const existing = await octokit.rest.pulls.list({
    owner,
    repo: name,
    head: `${owner}:${args.branch}`,
    state: "open",
  });
  if (existing.data.length > 0) {
    return existing.data[0]!.html_url;
  }

  const created = await octokit.rest.pulls.create({
    owner,
    repo: name,
    head: args.branch,
    base,
    title: args.title,
    body: args.body,
  });
  return created.data.html_url;
}

function extractCommitMessage(lastText: string): string {
  const match = lastText.match(/\*\*Commit message\*\*\s*:\s*(.+)$/im);
  if (match) {
    return match[1]!.trim().slice(0, 72);
  }
  const firstLine = lastText.split("\n").find((line) => line.trim().length > 0) ?? "chore: update";
  return (
    firstLine
      .replace(/^#+\s*/, "")
      .trim()
      .slice(0, 72) || "chore: update"
  );
}

/**
 * PR body = the subagent's `## Summary` + `## Test Plan` sections, minus the
 * trailing `**Commit message**: …` line (that already lives in the commit +
 * PR title), plus an attribution footer that names the Discord user who
 * asked. If the subagent didn't emit the expected structure we fall back to
 * the raw text so the PR is still useful — reviewers just won't see headers.
 */
function buildPrBody(lastText: string, authorUsername: string | undefined): string {
  const withoutCommitLine = stripTrailingCommitLine(lastText);
  const safeAuthorUsername = sanitizeAuthorUsername(authorUsername);
  // `@username` sits in a code span so GitHub doesn't try to notify a
  // like-named GitHub user; the link stays outside so it renders clickable.
  const attribution = safeAuthorUsername
    ? `Generated by \`@${safeAuthorUsername}\` using [Wack Hacker](https://github.com/purduehackers/wack-hacker)`
    : `Generated by [Wack Hacker](https://github.com/purduehackers/wack-hacker)`;
  return `${withoutCommitLine}\n\n${attribution}`;
}

/**
 * Remove only the *trailing* `**Commit message**:` line. Walking bottom-up
 * keeps us from deleting real content if the summary or test plan happens to
 * quote the same phrase earlier in the message.
 */
function stripTrailingCommitLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*\*\*Commit message\*\*\s*:/i.test(lines[i]!)) {
      lines.splice(i, 1);
      return lines.join("\n").trimEnd();
    }
  }
  return text.trim();
}

/**
 * Whitelist the Discord-username character set so a hostile or malformed
 * username can't inject markdown into the PR body. Discord's own username
 * rules (post-2023 unique-handle rollout) are already `[a-z0-9._]`, so this
 * strips nothing for normal users; it exists as defence-in-depth.
 */
function sanitizeAuthorUsername(authorUsername: string | undefined): string | undefined {
  if (!authorUsername) return undefined;
  const sanitized = authorUsername.replace(/[^A-Za-z0-9._-]/g, "").trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

function statusMessage(text: string): UIMessage {
  return {
    id: `code-post-${Date.now()}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncate(value: string, max = 1500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}
