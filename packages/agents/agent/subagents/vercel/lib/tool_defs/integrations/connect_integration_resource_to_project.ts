import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const connect_integration_resource_to_project = defineTool({
  description:
    "Connect a provisioned integration resource to a Vercel project. Auto-populates env vars. Trigger a new deploy for them to take effect.",
  access: { risk: "destructive" },
  input: z.strictObject({
    integration_configuration_id: z.string(),
    resource_id: z.string(),
    project_id: z.string(),
  }),
  execute: async ({ integration_configuration_id, resource_id, project_id }) => {
    await vercel().integrations.connectIntegrationResourceToProject({
      ...TEAM,
      integrationConfigurationId: integration_configuration_id,
      resourceId: resource_id,
      requestBody: { projectId: project_id },
    });
    return JSON.stringify({
      ok: true,
      configurationId: integration_configuration_id,
      resourceId: resource_id,
      projectId: project_id,
      note: "Env vars auto-populated. Trigger a new deployment for them to take effect.",
    });
  },
});
