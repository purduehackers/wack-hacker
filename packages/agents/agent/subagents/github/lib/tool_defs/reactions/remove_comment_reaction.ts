import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const remove_comment_reaction = defineTool({
  description: "Remove a reaction from an issue or PR comment by reaction ID.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    comment_id: resourceId.describe("Comment ID"),
    reaction_id: resourceId.describe("Reaction ID"),
  }),
  execute: async ({ repo, comment_id, reaction_id }) => {
    await octokit().rest.reactions.deleteForIssueComment({
      owner: env.GITHUB_ORG,
      repo,
      comment_id,
      reaction_id,
    });
    return JSON.stringify({ removed: true });
  },
});
