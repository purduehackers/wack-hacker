import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const remove_issue_reaction = defineTool({
  description: "Remove a reaction from an issue by reaction ID.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue number"),
    reaction_id: resourceId.describe("Reaction ID (from add_issue_reaction)"),
  }),
  execute: async ({ repo, issue_number, reaction_id }) => {
    await octokit().rest.reactions.deleteForIssue({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      reaction_id,
    });
    return JSON.stringify({ removed: true });
  },
});
