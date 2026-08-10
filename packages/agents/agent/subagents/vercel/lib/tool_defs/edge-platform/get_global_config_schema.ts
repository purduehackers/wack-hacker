import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_global_config_schema = defineTool({
  description: "Get the JSON Schema for a Global Config (validates future writes).",
  access: { risk: "read" },
  input: z.strictObject({ global_config_id: z.string() }),
  execute: async ({ global_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigSchema({
      ...TEAM,
      edgeConfigId: global_config_id,
    });
    return JSON.stringify(result);
  },
});
