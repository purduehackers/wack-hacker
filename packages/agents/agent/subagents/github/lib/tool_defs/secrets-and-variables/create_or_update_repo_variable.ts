import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit, octokitStatus } from "../../client.ts";
import { env, repoField, variableName } from "../../constants.ts";

export const create_or_update_repo_variable = defineTool({
  description: `Create or update an Actions variable for a repository. Updates if it exists, creates if it doesn't.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    name: variableName,
    value: z.string().describe("Variable value"),
  }),
  execute: async ({ repo, name, value }) => {
    try {
      await octokit().rest.actions.updateRepoVariable({
        owner: env.GITHUB_ORG,
        repo,
        name,
        value,
      });
    } catch (e: unknown) {
      if (octokitStatus(e) === 404) {
        await octokit().rest.actions.createRepoVariable({
          owner: env.GITHUB_ORG,
          repo,
          name,
          value,
        });
      } else throw e;
    }
    return JSON.stringify({ created_or_updated: true, name });
  },
});
