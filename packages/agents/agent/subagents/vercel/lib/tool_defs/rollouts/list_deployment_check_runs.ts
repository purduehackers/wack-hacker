import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_deployment_check_runs = defineTool({
  description: "List all check runs for a deployment.",
  access: { risk: "read" },
  input: z.strictObject({
    deployment_id: z.string(),
  }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().checksV2.listDeploymentCheckRuns({
      ...TEAM,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});
