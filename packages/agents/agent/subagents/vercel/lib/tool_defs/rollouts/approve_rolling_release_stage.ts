import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const approve_rolling_release_stage = defineTool({
  description: "Advance an in-flight rolling release to the next stage. Shifts production traffic.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    canaryDeploymentId: z.string(),
    nextStageIndex: z.int().min(0),
  }),
  execute: async ({ project_id_or_name, canaryDeploymentId, nextStageIndex }) => {
    const result = await vercel().rollingRelease.approveRollingReleaseStage({
      ...TEAM,
      idOrName: project_id_or_name,
      requestBody: { canaryDeploymentId, nextStageIndex },
    });
    return JSON.stringify(result);
  },
});
