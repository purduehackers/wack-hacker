import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { paginationInputShape, repoField, resourceId } from "./constants.ts";

const pullNumber = resourceId.describe("PR number");

/** `repo` plus the PR number and offset pagination — the shape every PR listing shares. */
const pullPaginatedInputShape = {
  repo: repoField,
  pull_number: pullNumber,
  ...paginationInputShape,
};

/** Create a new pull request. */
export const create_pull_request = defineTool({
  description: `Create a new pull request in a repository. Specify the head branch (with changes) and base branch (to merge into). Supports draft PRs and Markdown body. Returns the PR number, title, URL, and state.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    title: z.string().describe("PR title"),
    body: z.string().exactOptional().describe("PR body (Markdown)"),
    head: z.string().describe("Branch with changes"),
    base: z.string().describe("Branch to merge into"),
    draft: z.boolean().exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.create({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
      draft: data.draft,
    });
  },
});

/** Update an existing pull request's title, body, state, or base branch. */
export const update_pull_request = defineTool({
  description: `Update an existing pull request. Can change its title, body, state (open/closed), or base branch. Returns the updated PR summary.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    title: z.string().exactOptional(),
    body: z.string().exactOptional(),
    state: z.enum(["open", "closed"]).exactOptional(),
    base: z.string().exactOptional().describe("Change the base branch"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.update({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    });
  },
});

/** Merge a pull request using merge, squash, or rebase. */
export const merge_pull_request = defineTool({
  description: `Merge a pull request. Supports merge commit, squash, and rebase strategies. Optionally set a custom commit title and message. Returns whether the merge succeeded and the resulting SHA.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    commit_title: z.string().exactOptional().describe("Merge commit title"),
    commit_message: z.string().exactOptional().describe("Merge commit body"),
    merge_method: z.enum(["merge", "squash", "rebase"]).exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.merge({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      merged: data.merged,
      sha: data.sha,
      message: data.message,
    });
  },
});

/** Close a pull request without merging. */
export const close_pull_request = defineTool({
  description:
    "Close a pull request without merging. Does not delete the branch. Use update_pull_request with state='open' to reopen.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
  }),
  execute: async ({ repo, pull_number }) => {
    const { data } = await octokit().rest.pulls.update({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      state: "closed",
    });
    return JSON.stringify({ closed: true, number: data.number, html_url: data.html_url });
  },
});

/** Request reviewers on a pull request. */
export const request_reviewers = defineTool({
  description: "Request reviewers on a pull request. Can request individual users and/or teams.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    reviewers: z
      .array(z.string())
      .exactOptional()
      .describe("GitHub usernames to request as reviewers"),
    team_reviewers: z
      .array(z.string())
      .exactOptional()
      .describe("Team slugs to request as reviewers"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.requestReviewers({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      requested_reviewers: data.requested_reviewers?.map((r) => r.login),
      requested_teams: data.requested_teams?.map((t) => t.slug),
    });
  },
});

/** Remove requested reviewers from a pull request. */
export const remove_requested_reviewers = defineTool({
  description: "Remove previously-requested reviewers from a pull request.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    reviewers: z.array(z.string()).describe("GitHub usernames to remove"),
    team_reviewers: z.array(z.string()).optional().describe("Team slugs to remove"),
  }),
  execute: async ({ repo, pull_number, reviewers, team_reviewers }) => {
    const { data } = await octokit().rest.pulls.removeRequestedReviewers({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      reviewers,
      team_reviewers: team_reviewers ?? [],
    });
    return JSON.stringify({
      number: data.number,
      requested_reviewers: data.requested_reviewers?.map((r) => r.login),
    });
  },
});

/** List reviews on a pull request. */
export const list_pr_reviews = defineTool({
  description: `List reviews on a pull request. Returns each review's ID, author, state (APPROVED, CHANGES_REQUESTED, COMMENTED, etc.), body, and timestamp. Useful for checking approval status.`,
  access: { risk: "read" },
  input: z.strictObject(pullPaginatedInputShape),
  execute: async ({ repo, pull_number, per_page, page }) => {
    const { data } = await octokit().rest.pulls.listReviews({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((r) => ({
        id: r.id,
        user: r.user?.login,
        state: r.state,
        body: r.body,
        submitted_at: r.submitted_at,
        html_url: r.html_url,
      })),
    );
  },
});

/** Submit a review on a pull request (approve, request changes, or comment). */
export const create_pr_review = defineTool({
  description: `Submit a review on a pull request. Can APPROVE, REQUEST_CHANGES, or leave a COMMENT. Include a body with your review feedback.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    body: z.string().exactOptional().describe("Review body"),
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review action"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.createReview({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      state: data.state,
      html_url: data.html_url,
    });
  },
});

/** List files changed in a pull request. */
export const list_pr_files = defineTool({
  description: `List files changed in a pull request. Returns each file's name, status (added/modified/removed), lines added/deleted, and a truncated patch preview. Useful for understanding the scope of changes.`,
  access: { risk: "read" },
  input: z.strictObject(pullPaginatedInputShape),
  execute: async ({ repo, pull_number, per_page, page }) => {
    const { data } = await octokit().rest.pulls.listFiles({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch?.slice(0, 500),
      })),
    );
  },
});

/** List review comments (inline code comments) on a pull request. */
export const list_pr_comments = defineTool({
  description: `List review comments (inline code comments) on a pull request. Returns each comment's ID, body, file path, line number, author, and timestamp. Different from issue comments -- these are tied to specific lines of code.`,
  access: { risk: "read" },
  input: z.strictObject(pullPaginatedInputShape),
  execute: async ({ repo, pull_number, per_page, page }) => {
    const { data } = await octokit().rest.pulls.listReviewComments({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((c) => ({
        id: c.id,
        body: c.body,
        path: c.path,
        line: c.line,
        user: c.user?.login,
        created_at: c.created_at,
        html_url: c.html_url,
      })),
    );
  },
});
