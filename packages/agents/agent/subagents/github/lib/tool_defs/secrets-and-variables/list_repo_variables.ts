import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoPaginatedInputShape } from "../../constants.ts";

export const list_repo_variables = defineTool({
  description: `List Actions variables for a repository. Unlike secrets, variable values are readable.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.actions.listRepoVariables({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      variables: data.variables.map((v) => ({
        name: v.name,
        value: v.value,
        created_at: v.created_at,
        updated_at: v.updated_at,
      })),
    });
  },
});
