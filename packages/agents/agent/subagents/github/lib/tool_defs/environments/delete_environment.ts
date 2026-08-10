import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, environmentName, repoField } from "../../constants.ts";

export const delete_environment = defineTool({
  description: "Delete a deployment environment. Associated deployments become unenvironmented.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    environment_name: environmentName,
  }),
  execute: async ({ repo, environment_name }) => {
    await octokit().rest.repos.deleteAnEnvironment({
      owner: env.GITHUB_ORG,
      repo,
      environment_name,
    });
    return JSON.stringify({ deleted: true, environment_name });
  },
});
