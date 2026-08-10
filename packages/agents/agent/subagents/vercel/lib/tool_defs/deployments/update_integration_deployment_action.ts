import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const update_integration_deployment_action = defineTool({
  description: "Update the deployment integration action state for a specific integration install.",
  access: { risk: "write" },
  input: z.strictObject({
    deployment_id: z.string(),
    integrationConfigurationId: z.string(),
    resourceId: z.string(),
    action: z.string(),
  }),
  execute: async ({ deployment_id, integrationConfigurationId, resourceId, action }) => {
    await vercel().deployments.updateIntegrationDeploymentAction({
      ...TEAM,
      deploymentId: deployment_id,
      integrationConfigurationId,
      resourceId,
      action,
    });
    return JSON.stringify({ ok: true });
  },
});
