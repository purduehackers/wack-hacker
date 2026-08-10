import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const assign_alias = defineTool({
  description: "Assign an alias (hostname) to a deployment.",
  access: { risk: "destructive" },
  input: z.strictObject({
    deployment_id: z.string(),
    // Not `z.hostname()`: a wildcard alias (`*.purduehackers.com`) is assignable.
    alias: z.string().describe("The hostname to assign (e.g. 'staging.purduehackers.com')"),
    redirect: z
      .hostname()
      .optional()
      .describe("Hostname to 307-redirect to instead of the deployment"),
  }),
  execute: async ({ deployment_id, alias, redirect }) => {
    const result = await vercel().aliases.assignAlias({
      ...TEAM,
      id: deployment_id,
      requestBody: { alias, redirect },
    });
    return JSON.stringify(result);
  },
});
