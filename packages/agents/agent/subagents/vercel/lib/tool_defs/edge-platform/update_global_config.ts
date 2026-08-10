import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const update_global_config = defineTool({
  description: "Rename a Global Config.",
  access: { risk: "destructive" },
  input: z.strictObject({
    global_config_id: z.string(),
    slug: z.string(),
  }),
  execute: async ({ global_config_id, slug }) => {
    const result = await vercel().edgeConfig.updateEdgeConfig({
      ...TEAM,
      edgeConfigId: global_config_id,
      requestBody: { slug },
    });
    return JSON.stringify(result);
  },
});
