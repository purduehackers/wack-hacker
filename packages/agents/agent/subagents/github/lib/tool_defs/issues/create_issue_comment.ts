import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, issueNumber, repoField } from "../../constants.ts";

export const create_issue_comment = defineTool({
  description: `Add a new comment to an issue. Supports Markdown. Returns the comment ID and URL.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: issueNumber,
    body: z.string().describe("Comment body (Markdown)"),
  }),
  execute: async ({ repo, issue_number, body }) => {
    const { data } = await octokit().rest.issues.createComment({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      body,
    });
    return JSON.stringify({ id: data.id, html_url: data.html_url });
  },
});
