import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const complete_rolling_release = defineTool({
  description: "Complete a rolling release — route 100% of traffic to the new deployment.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    canaryDeploymentId: z.string(),
  }),
  execute: async ({ project_id_or_name, canaryDeploymentId }) => {
    const result = await vercel().rollingRelease.completeRollingRelease({
      ...TEAM,
      idOrName: project_id_or_name,
      requestBody: { canaryDeploymentId },
    });
    return JSON.stringify(result);
  },
});
