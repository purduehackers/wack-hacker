import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { commentId, env, repoField } from "../../constants.ts";

export const delete_issue_comment = defineTool({
  description: `Permanently delete an issue comment by its ID. This action cannot be undone.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    comment_id: commentId,
  }),
  execute: async ({ repo, comment_id }) => {
    await octokit().rest.issues.deleteComment({
      owner: env.GITHUB_ORG,
      repo,
      comment_id,
    });
    return JSON.stringify({ deleted: true });
  },
});
