import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, reactionSchema, repoField, resourceId } from "../../constants.ts";

export const add_comment_reaction = defineTool({
  description: "Add a reaction to an issue or PR comment.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    comment_id: resourceId.describe("Comment ID"),
    content: reactionSchema,
  }),
  execute: async ({ repo, comment_id, content }) => {
    const { data } = await octokit().rest.reactions.createForIssueComment({
      owner: env.GITHUB_ORG,
      repo,
      comment_id,
      content,
    });
    return JSON.stringify({ id: data.id, content: data.content });
  },
});
