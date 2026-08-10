import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, variableName } from "../../constants.ts";

export const delete_org_variable = defineTool({
  description: `Delete an Actions variable from the organization.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    name: variableName,
  }),
  execute: async ({ name }) => {
    await octokit().rest.actions.deleteOrgVariable({ org: env.GITHUB_ORG, name });
    return JSON.stringify({ deleted: true, name });
  },
});
