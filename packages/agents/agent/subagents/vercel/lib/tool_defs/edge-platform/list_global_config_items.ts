import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_global_config_items = defineTool({
  description: "List all items in a Global Config.",
  access: { risk: "read" },
  input: z.strictObject({ global_config_id: z.string() }),
  execute: async ({ global_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigItems({
      ...TEAM,
      edgeConfigId: global_config_id,
    });
    return JSON.stringify(result);
  },
});
