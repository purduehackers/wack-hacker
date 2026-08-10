import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, secretName } from "../../constants.ts";

export const delete_org_secret = defineTool({
  description: `Delete an Actions secret from the organization.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    secret_name: secretName,
  }),
  execute: async ({ secret_name }) => {
    await octokit().rest.actions.deleteOrgSecret({
      org: env.GITHUB_ORG,
      secret_name,
    });
    return JSON.stringify({ deleted: true, secret_name });
  },
});
