import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullPaginatedInputShape } from "../../constants.ts";

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
