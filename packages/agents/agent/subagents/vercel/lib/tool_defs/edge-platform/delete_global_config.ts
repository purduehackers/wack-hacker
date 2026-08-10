import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_global_config = defineTool({
  description: "Permanently delete a Global Config store.",
  access: { risk: "destructive" },
  input: z.strictObject({ global_config_id: z.string() }),
  execute: async ({ global_config_id }) => {
    await vercel().edgeConfig.deleteEdgeConfig({
      ...TEAM,
      edgeConfigId: global_config_id,
    });
    return JSON.stringify({ ok: true, id: global_config_id });
  },
});
