import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { pageLimit, TEAM } from "../../constants.ts";

export const list_global_config_backups = defineTool({
  description: "List automatic backups for a Global Config.",
  access: { risk: "read" },
  input: z.strictObject({
    global_config_id: z.string(),
    limit: pageLimit.optional(),
  }),
  execute: async ({ global_config_id, limit }) => {
    const result = await vercel().edgeConfig.getEdgeConfigBackups({
      ...TEAM,
      edgeConfigId: global_config_id,
      limit,
    });
    return JSON.stringify(result);
  },
});
