import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const create_global_config = defineTool({
  description: "Create a new Global Config store.",
  access: { risk: "write" },
  input: z.strictObject({
    slug: z.string(),
  }),
  execute: async ({ slug }) => {
    const result = await vercel().edgeConfig.createEdgeConfig({
      ...TEAM,
      requestBody: { slug },
    });
    return JSON.stringify(result);
  },
});
