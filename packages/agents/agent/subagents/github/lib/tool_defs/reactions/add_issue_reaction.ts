import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, reactionSchema, repoField, resourceId } from "../../constants.ts";

export const add_issue_reaction = defineTool({
  description: "Add a reaction emoji to an issue. Returns the reaction ID for later removal.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue number"),
    content: reactionSchema,
  }),
  execute: async ({ repo, issue_number, content }) => {
    const { data } = await octokit().rest.reactions.createForIssue({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      content,
    });
    return JSON.stringify({ id: data.id, content: data.content });
  },
});
