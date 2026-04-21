import type { UIMessage } from "ai";

import { log } from "evlog";
import { z } from "zod";

import type { Sandbox } from "@/lib/sandbox/types";

import { countMetric } from "@/lib/metrics";
import { getOrCreateSession } from "@/lib/sandbox/session";

import type { AgentContext } from "../../context.ts";
import type { CodingSandboxContext } from "./utils.ts";

import { env } from "../../../../env.ts";
import { octokit } from "../github/client.ts";

/** Input schema for `delegate_code`. */
export const codeDelegationInputSchema = z.object({
  repo: z
    .string()
    .describe(
      `Target repository in the \`${env.GITHUB_ORG}/<name>\` form. Refused if outside the org.`,
    ),
  task: z.string().describe("The user's task, forwarded verbatim to the coding subagent"),
});

export type { CodeDelegationInput } from "./types.ts";

const GIT_USER = {
  name: "phoenix-bot",
  email: "bot@purduehackers.com",
};

export async function buildCodeExperimentalContext(
  input: unknown,
  agentContext: AgentContext,
): Promise<CodingSandboxContext> {
  const parsed = codeDelegationInputSchema.parse(input);
  if (!parsed.repo.startsWith(`${env.GITHUB_ORG}/`)) {
    throw new Error(
      `Repo ${parsed.repo} is outside ${env.GITHUB_ORG}; code delegation is scoped to that org.`,
    );
  }

  const threadKey = agentContext.thread?.id ?? agentContext.channel.id;
  const installationToken = await mintInstallationToken();

  const session = await getOrCreateSession({
    threadKey,
    repo: parsed.repo,
    githubToken: installationToken,
    gitUser: GIT_USER,
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
  experimentalContext: unknown;
  lastAssistantText: string;
}): AsyncGenerator<UIMessage, void, void> {
  const ctx = args.experimentalContext as CodingSandboxContext | undefined;
  if (!ctx) {
    log.warn("code-delegation", "postFinish invoked without experimental context — skipping");
    return;
  }
  const { sandbox, repo, branch } = ctx;

  const status = await sandbox.exec("git status --porcelain", { cwd: ctx.repoDir });
  if (status.exitCode !== 0) {
    yield statusMessage(
      `Post-finish aborted: \`git status\` exited ${status.exitCode}. stderr: ${truncate(status.stderr)}`,
    );
    return;
  }
  if (!status.stdout.trim()) {
    yield statusMessage("No changes to commit. Nothing pushed; no PR opened.");
    return;
  }

  const commitMessage = extractCommitMessage(args.lastAssistantText);

  await sandbox.exec("git add -A", { cwd: ctx.repoDir });
  const commitResult = await sandbox.exec(`git commit -m ${shellQuote(commitMessage)}`, {
    cwd: ctx.repoDir,
  });
  if (commitResult.exitCode !== 0) {
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
      body: buildPrBody(args.lastAssistantText),
      sandbox,
      repoDir: ctx.repoDir,
    });
  } catch (err) {
    yield statusMessage(
      `Branch \`${branch}\` pushed but opening the PR failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  countMetric("ai.code_delegate.pr_opened");
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

function buildPrBody(lastText: string): string {
  return `${lastText.trim()}\n\n---\n_Opened by Phoenix's coding agent._`;
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
