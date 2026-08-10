import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape } from "../../constants.ts";

export const list_org_variables = defineTool({
  description: `List Actions variables for the purduehackers organization. Returns name, value, timestamps, and visibility scope.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.actions.listOrgVariables({
      org: env.GITHUB_ORG,
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
        visibility: v.visibility,
      })),
    });
  },
});
