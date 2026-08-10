import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_global_configs = defineTool({
  description: "List every Global Config store in the team.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().edgeConfig.getEdgeConfigs({ ...TEAM });
    return JSON.stringify(result);
  },
});
