import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, environmentName, repoField } from "../../constants.ts";

export const get_environment = defineTool({
  description: "Get details for a single deployment environment, including protection rules.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    environment_name: environmentName,
  }),
  execute: async ({ repo, environment_name }) => {
    const { data } = await octokit().rest.repos.getEnvironment({
      owner: env.GITHUB_ORG,
      repo,
      environment_name,
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      html_url: data.html_url,
      created_at: data.created_at,
      updated_at: data.updated_at,
      protection_rules: data.protection_rules,
    });
  },
});
