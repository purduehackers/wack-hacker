import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, variableName } from "../../constants.ts";

export const delete_repo_variable = defineTool({
  description: `Delete an Actions variable from a repository.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    name: variableName,
  }),
  execute: async ({ repo, name }) => {
    await octokit().rest.actions.deleteRepoVariable({
      owner: env.GITHUB_ORG,
      repo,
      name,
    });
    return JSON.stringify({ deleted: true, name });
  },
});
