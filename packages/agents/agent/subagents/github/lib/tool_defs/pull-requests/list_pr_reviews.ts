import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullPaginatedInputShape } from "../../constants.ts";

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
