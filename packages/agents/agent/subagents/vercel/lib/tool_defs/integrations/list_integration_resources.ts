import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";

export const list_integration_resources = defineTool({
  description:
    "List every resource provisioned under an integration installation (e.g. every Turso DB under the Turso integration).",
  access: { risk: "read" },
  input: z.strictObject({ configuration_id: z.string() }),
  execute: async ({ configuration_id }) => {
    const result = await vercel().marketplace.getIntegrationResources({
      integrationConfigurationId: configuration_id,
    });
    return JSON.stringify(result);
  },
});
