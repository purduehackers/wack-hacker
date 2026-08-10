import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, issueNumber, paginationInputShape, repoField } from "../../constants.ts";

export const list_issue_comments = defineTool({
  description: `List comments on an issue. Returns each comment's ID, body, author, timestamps, and URL. Useful for understanding discussion history.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    issue_number: issueNumber,
    ...paginationInputShape,
  }),
  execute: async ({ repo, issue_number, per_page, page }) => {
    const { data } = await octokit().rest.issues.listComments({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((c) => ({
        id: c.id,
        body: c.body,
        user: c.user?.login,
        created_at: c.created_at,
        updated_at: c.updated_at,
        html_url: c.html_url,
      })),
    );
  },
});
