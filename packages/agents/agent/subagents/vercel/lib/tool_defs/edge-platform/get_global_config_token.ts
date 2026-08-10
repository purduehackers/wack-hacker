import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { redactTokens, TEAM } from "../../constants.ts";

export const get_global_config_token = defineTool({
  description:
    "Retrieve a specific Global Config read token's metadata. **Strips the raw `token` field** from the response.",
  access: { risk: "read" },
  input: z.strictObject({
    global_config_id: z.string(),
    token: z.string(),
  }),
  execute: async ({ global_config_id, token }) => {
    const result = await vercel().edgeConfig.getEdgeConfigToken({
      ...TEAM,
      edgeConfigId: global_config_id,
      token,
    });
    return JSON.stringify(redactTokens(result));
  },
});
