import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_global_config_tokens = defineTool({
  description: "Delete one or more Global Config read tokens.",
  access: { risk: "destructive" },
  input: z.strictObject({
    global_config_id: z.string(),
    tokens: z.array(z.string()).min(1),
  }),
  execute: async ({ global_config_id, tokens }) => {
    await vercel().edgeConfig.deleteEdgeConfigTokens({
      ...TEAM,
      edgeConfigId: global_config_id,
      requestBody: { tokens },
    });
    return JSON.stringify({ ok: true, tokens });
  },
});
