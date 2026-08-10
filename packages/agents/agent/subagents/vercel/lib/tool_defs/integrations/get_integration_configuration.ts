import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_integration_configuration = defineTool({
  description: "Get a specific integration configuration by id.",
  access: { risk: "read" },
  input: z.strictObject({ configuration_id: z.string() }),
  execute: async ({ configuration_id }) => {
    const result = await vercel().integrations.getConfiguration({
      ...TEAM,
      id: configuration_id,
    });
    return JSON.stringify(result);
  },
});
