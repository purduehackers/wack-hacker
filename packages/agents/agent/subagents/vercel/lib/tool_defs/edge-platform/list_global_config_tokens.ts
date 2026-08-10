import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { redactTokens, TEAM } from "../../constants.ts";

export const list_global_config_tokens = defineTool({
  description:
    "List read tokens for a Global Config. **Always strips the raw `token` field** — returns id/label/createdAt metadata only. The Vercel dashboard is the only path for retrieving an existing token's secret.",
  access: { risk: "read" },
  input: z.strictObject({ global_config_id: z.string() }),
  execute: async ({ global_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigTokens({
      ...TEAM,
      edgeConfigId: global_config_id,
    });
    return JSON.stringify(redactTokens(result));
  },
});
