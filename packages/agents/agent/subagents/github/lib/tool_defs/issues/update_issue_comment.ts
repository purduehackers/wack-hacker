import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { commentId, env, repoField } from "../../constants.ts";

export const update_issue_comment = defineTool({
  description: `Edit an existing issue comment by its ID. Replaces the entire body with the new Markdown content. Returns the comment ID and URL.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    comment_id: commentId,
    body: z.string().describe("New comment body (Markdown)"),
  }),
  execute: async ({ repo, comment_id, body }) => {
    const { data } = await octokit().rest.issues.updateComment({
      owner: env.GITHUB_ORG,
      repo,
      comment_id,
      body,
    });
    return JSON.stringify({ id: data.id, html_url: data.html_url });
  },
});
