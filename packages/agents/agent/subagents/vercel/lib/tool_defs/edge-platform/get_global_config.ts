import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_global_config = defineTool({
  description: "Retrieve a single Global Config by id.",
  access: { risk: "read" },
  input: z.strictObject({ global_config_id: z.string() }),
  execute: async ({ global_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfig({
      ...TEAM,
      edgeConfigId: global_config_id,
    });
    return JSON.stringify(result);
  },
});
