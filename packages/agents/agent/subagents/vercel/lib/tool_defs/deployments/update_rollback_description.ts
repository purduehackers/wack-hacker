import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const update_rollback_description = defineTool({
  description: "Update the description (reason) attached to an active rollback.",
  access: { risk: "write" },
  input: z.strictObject({
    project_id: z.string(),
    deployment_id: z.string(),
    description: z.string(),
  }),
  execute: async ({ project_id, deployment_id, description }) => {
    await vercel().projects.updateProjectsByProjectIdRollbackByDeploymentIdUpdateDescription({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
      requestBody: { description },
    });
    return JSON.stringify({ ok: true });
  },
});
