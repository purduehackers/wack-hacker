import { createHash } from "node:crypto";

import { createAppAuth } from "@octokit/auth-app";
import type { InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import { Octokit } from "octokit";

import { env } from "../../../env.ts";

export const CODE_GITHUB_OWNER = "purduehackers";
const CODE_REPOSITORY_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/u;

export function isCodeRepositoryName(value: string): boolean {
  return CODE_REPOSITORY_NAME.test(value);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new Error(`Code publication is unavailable because ${name} is not configured.`);
  }
  return value;
}

/** Mint one repository-scoped installation token and keep it in agent runtime. */
export async function createCodePublicationRuntime(repoName: string) {
  if (!isCodeRepositoryName(repoName)) {
    throw new Error("Code publication repository name is outside policy.");
  }
  if (env.GITHUB_ORG !== undefined && env.GITHUB_ORG.toLowerCase() !== CODE_GITHUB_OWNER) {
    throw new Error("Configured GitHub organization does not match the code publication policy.");
  }
  const auth = createAppAuth({
    appId: required(env.GITHUB_APP_ID, "GITHUB_APP_ID"),
    privateKey: required(env.GITHUB_APP_PRIVATE_KEY, "GITHUB_APP_PRIVATE_KEY"),
    installationId: required(env.GITHUB_APP_INSTALLATION_ID, "GITHUB_APP_INSTALLATION_ID"),
  });
  const installation: InstallationAccessTokenAuthentication = await auth({
    type: "installation",
    repositoryNames: [repoName],
    permissions: { contents: "write", pull_requests: "write" },
  });
  return {
    client: new Octokit({ auth: installation.token }),
    token: installation.token,
  };
}

export function featureBranchFor(sessionId: string, repoName: string): string {
  if (!isCodeRepositoryName(repoName)) {
    throw new Error("Code publication repository name is outside policy.");
  }
  const suffix = createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(repoName)
    .digest("hex")
    .slice(0, 12);
  return `wack-hacker/${repoName}-${suffix}`;
}

type PullsClient = Pick<InstanceType<typeof Octokit>["rest"]["pulls"], "create" | "list">;

async function findPullRequest(
  pulls: PullsClient,
  input: { readonly branch: string; readonly repoName: string },
) {
  const listed = await pulls.list({
    owner: CODE_GITHUB_OWNER,
    repo: input.repoName,
    head: `${CODE_GITHUB_OWNER}:${input.branch}`,
    state: "all",
    per_page: 10,
  });
  return listed.data[0];
}

/** Reuses any PR for this deterministic branch, including after a replay race. */
export async function ensureCodePullRequest(
  pulls: PullsClient,
  input: {
    readonly base: string;
    readonly body?: string;
    readonly branch: string;
    readonly repoName: string;
    readonly title: string;
  },
) {
  const existing = await findPullRequest(pulls, input);
  if (existing !== undefined) {
    return {
      number: existing.number,
      state: existing.state,
      url: existing.html_url,
      reused: true,
    };
  }

  try {
    const created = await pulls.create({
      owner: CODE_GITHUB_OWNER,
      repo: input.repoName,
      head: input.branch,
      base: input.base,
      title: input.title,
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    return {
      number: created.data.number,
      state: created.data.state,
      url: created.data.html_url,
      reused: false,
    };
  } catch (cause) {
    // A replay/concurrent retry can observe list-before-create and then lose the
    // create race. Re-list before surfacing the original SDK error.
    const raced = await findPullRequest(pulls, input);
    if (raced === undefined) throw cause;
    return {
      number: raced.number,
      state: raced.state,
      url: raced.html_url,
      reused: true,
    };
  }
}
