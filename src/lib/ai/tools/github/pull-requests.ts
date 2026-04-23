import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { approval } from "../../approvals/index.ts";
import { paginationInputShape } from "../_shared/constants.ts";
import { octokit } from "./client.ts";

/** Create a new pull request. */
export const create_pull_request = tool({
  description: `Create a new pull request in a repository. Specify the head branch (with changes) and base branch (to merge into). Supports draft PRs and Markdown body. Returns the PR number, title, URL, and state.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    title: z.string().describe("PR title"),
    body: z.string().optional().describe("PR body (Markdown)"),
    head: z.string().describe("Branch with changes"),
    base: z.string().describe("Branch to merge into"),
    draft: z.boolean().optional(),
  }),
  execute: async ({ repo, ...input }) => {
    const { data } = await octokit.rest.pulls.create({
      owner: env.GITHUB_ORG,
      repo,
      ...input,
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
export const update_pull_request = tool({
  description: `Update an existing pull request. Can change its title, body, state (open/closed), or base branch. Returns the updated PR summary.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("PR number"),
    title: z.string().optional(),
    body: z.string().optional(),
    state: z.enum(["open", "closed"]).optional(),
    base: z.string().optional().describe("Change the base branch"),
  }),
  execute: async ({ repo, pull_number, ...input }) => {
    const { data } = await octokit.rest.pulls.update({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      ...input,
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
export const merge_pull_request = approval(
  tool({
    description: `Merge a pull request. Supports merge commit, squash, and rebase strategies. Optionally set a custom commit title and message. Returns whether the merge succeeded and the resulting SHA.`,
    inputSchema: z.object({
      repo: z.string().describe("Repository name"),
      pull_number: z.number().describe("PR number"),
      commit_title: z.string().optional().describe("Merge commit title"),
      commit_message: z.string().optional().describe("Merge commit body"),
      merge_method: z.enum(["merge", "squash", "rebase"]).optional(),
    }),
    execute: async ({ repo, pull_number, ...input }) => {
      const { data } = await octokit.rest.pulls.merge({
        owner: env.GITHUB_ORG,
        repo,
        pull_number,
        ...input,
      });
      return JSON.stringify({
        merged: data.merged,
        sha: data.sha,
        message: data.message,
      });
    },
  }),
);

/** Close a pull request without merging. */
export const close_pull_request = approval(
  tool({
    description:
      "Close a pull request without merging. Does not delete the branch. Use update_pull_request with state='open' to reopen.",
    inputSchema: z.object({
      repo: z.string().describe("Repository name"),
      pull_number: z.number().describe("PR number"),
    }),
    execute: async ({ repo, pull_number }) => {
      const { data } = await octokit.rest.pulls.update({
        owner: env.GITHUB_ORG,
        repo,
        pull_number,
        state: "closed",
      });
      return JSON.stringify({ closed: true, number: data.number, html_url: data.html_url });
    },
  }),
);

/** Request reviewers on a pull request. */
export const request_reviewers = tool({
  description: "Request reviewers on a pull request. Can request individual users and/or teams.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("PR number"),
    reviewers: z.array(z.string()).optional().describe("GitHub usernames to request as reviewers"),
    team_reviewers: z.array(z.string()).optional().describe("Team slugs to request as reviewers"),
  }),
  execute: async ({ repo, pull_number, reviewers, team_reviewers }) => {
    const { data } = await octokit.rest.pulls.requestReviewers({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      reviewers,
      team_reviewers,
    });
    return JSON.stringify({
      number: data.number,
      requested_reviewers: data.requested_reviewers?.map((r) => r.login),
      requested_teams: data.requested_teams?.map((t) => t.slug),
    });
  },
});

/** Remove requested reviewers from a pull request. */
export const remove_requested_reviewers = approval(
  tool({
    description: "Remove previously-requested reviewers from a pull request.",
    inputSchema: z.object({
      repo: z.string().describe("Repository name"),
      pull_number: z.number().describe("PR number"),
      reviewers: z.array(z.string()).describe("GitHub usernames to remove"),
      team_reviewers: z.array(z.string()).optional().describe("Team slugs to remove"),
    }),
    execute: async ({ repo, pull_number, reviewers, team_reviewers }) => {
      const { data } = await octokit.rest.pulls.removeRequestedReviewers({
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
  }),
);

/** List reviews on a pull request. */
export const list_pr_reviews = tool({
  description: `List reviews on a pull request. Returns each review's ID, author, state (APPROVED, CHANGES_REQUESTED, COMMENTED, etc.), body, and timestamp. Useful for checking approval status.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("PR number"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, pull_number, per_page, page }) => {
    const { data } = await octokit.rest.pulls.listReviews({
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
export const create_pr_review = tool({
  description: `Submit a review on a pull request. Can APPROVE, REQUEST_CHANGES, or leave a COMMENT. Include a body with your review feedback.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("PR number"),
    body: z.string().optional().describe("Review body"),
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review action"),
  }),
  execute: async ({ repo, pull_number, body, event }) => {
    const { data } = await octokit.rest.pulls.createReview({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      body,
      event,
    });
    return JSON.stringify({
      id: data.id,
      state: data.state,
      html_url: data.html_url,
    });
  },
});

/** List files changed in a pull request. */
export const list_pr_files = tool({
  description: `List files changed in a pull request. Returns each file's name, status (added/modified/removed), lines added/deleted, and a truncated patch preview. Useful for understanding the scope of changes.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("PR number"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, pull_number, per_page, page }) => {
    const { data } = await octokit.rest.pulls.listFiles({
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
export const list_pr_comments = tool({
  description: `List review comments (inline code comments) on a pull request. Returns each comment's ID, body, file path, line number, author, and timestamp. Different from issue comments -- these are tied to specific lines of code.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("PR number"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, pull_number, per_page, page }) => {
    const { data } = await octokit.rest.pulls.listReviewComments({
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
