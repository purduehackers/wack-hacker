import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_global_config_schema = defineTool({
  description: "Delete the schema definition on a Global Config.",
  access: { risk: "destructive" },
  input: z.strictObject({ global_config_id: z.string() }),
  execute: async ({ global_config_id }) => {
    await vercel().edgeConfig.deleteEdgeConfigSchema({
      ...TEAM,
      edgeConfigId: global_config_id,
    });
    return JSON.stringify({ ok: true });
  },
});
