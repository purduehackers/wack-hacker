import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const patch_global_config_items = defineTool({
  description:
    "Upsert or delete items in a Global Config. Pass an array of operations: { operation: 'create'|'update'|'upsert'|'delete', key, value? }.",
  access: { risk: "destructive" },
  input: z.strictObject({
    global_config_id: z.string(),
    items: z
      .array(
        z.strictObject({
          operation: z.enum(["create", "update", "upsert", "delete"]),
          key: z.string(),
          value: z.unknown().optional(),
        }),
      )
      .min(1),
  }),
  execute: async ({ global_config_id, items }) => {
    const result = await vercel().edgeConfig.patchEdgeConfigItems({
      ...TEAM,
      edgeConfigId: global_config_id,
      requestBody: { items },
    });
    return JSON.stringify(result);
  },
});
