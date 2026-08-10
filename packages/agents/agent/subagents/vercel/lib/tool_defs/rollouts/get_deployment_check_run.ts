import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_deployment_check_run = defineTool({
  description: "Get a check run's details.",
  access: { risk: "read" },
  input: z.strictObject({
    deployment_id: z.string(),
    check_run_id: z.string(),
  }),
  execute: async ({ deployment_id, check_run_id }) => {
    const result = await vercel().checksV2.getDeploymentCheckRun({
      ...TEAM,
      deploymentId: deployment_id,
      checkRunId: check_run_id,
    });
    return JSON.stringify(result);
  },
});
