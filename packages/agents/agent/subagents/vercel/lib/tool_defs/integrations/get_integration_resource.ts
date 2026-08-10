import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";

export const get_integration_resource = defineTool({
  description: "Retrieve a specific integration resource by id.",
  access: { risk: "read" },
  input: z.strictObject({
    configuration_id: z.string(),
    resource_id: z.string(),
  }),
  execute: async ({ configuration_id, resource_id }) => {
    const result = await vercel().marketplace.getIntegrationResource({
      integrationConfigurationId: configuration_id,
      resourceId: resource_id,
    });
    return JSON.stringify(result);
  },
});
