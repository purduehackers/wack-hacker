import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";

export const delete_integration_resource = defineTool({
  description:
    "Permanently delete a provisioned integration resource (e.g. drop a Turso DB). Data is LOST.",
  access: { risk: "destructive" },
  input: z.strictObject({
    configuration_id: z.string(),
    resource_id: z.string(),
  }),
  execute: async ({ configuration_id, resource_id }) => {
    await vercel().marketplace.deleteIntegrationResource({
      integrationConfigurationId: configuration_id,
      resourceId: resource_id,
    });
    return JSON.stringify({ ok: true, resourceId: resource_id });
  },
});
