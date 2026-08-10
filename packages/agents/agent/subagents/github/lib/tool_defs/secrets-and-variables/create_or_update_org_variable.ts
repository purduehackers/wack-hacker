import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit, octokitStatus } from "../../client.ts";
import { env, selectedRepositoryIds, variableName, visibilityField } from "../../constants.ts";

export const create_or_update_org_variable = defineTool({
  description: `Create or update an Actions variable for the organization. Updates if it exists, creates if it doesn't. Set visibility to control repo access.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    name: variableName,
    value: z.string().describe("Variable value"),
    visibility: visibilityField,
    selected_repository_ids: selectedRepositoryIds,
  }),
  execute: async (input) => {
    try {
      await octokit().rest.actions.updateOrgVariable({
        org: env.GITHUB_ORG,
        ...input,
      });
    } catch (e: unknown) {
      if (octokitStatus(e) === 404) {
        await octokit().rest.actions.createOrgVariable({
          org: env.GITHUB_ORG,
          ...input,
        });
      } else throw e;
    }
    return JSON.stringify({ created_or_updated: true, name: input.name });
  },
});
