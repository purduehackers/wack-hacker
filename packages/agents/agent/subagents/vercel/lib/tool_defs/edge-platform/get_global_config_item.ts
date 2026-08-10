import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_global_config_item = defineTool({
  description: "Get a single item by key from a Global Config.",
  access: { risk: "read" },
  input: z.strictObject({
    global_config_id: z.string(),
    key: z.string(),
  }),
  execute: async ({ global_config_id, key }) => {
    const result = await vercel().edgeConfig.getEdgeConfigItem({
      ...TEAM,
      edgeConfigId: global_config_id,
      edgeConfigItemKey: key,
    });
    return JSON.stringify(result);
  },
});
