import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const remove_collaborator = defineTool({
  description: "Remove a collaborator from a repository. Revokes their direct access.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    repo: repoField,
    username: z.string().min(1).describe("GitHub username to remove"),
  }),
  execute: async ({ repo, username }) => {
    await octokit().rest.repos.removeCollaborator({
      owner: env.GITHUB_ORG,
      repo,
      username,
    });
    return JSON.stringify({ removed: true, username });
  },
});
