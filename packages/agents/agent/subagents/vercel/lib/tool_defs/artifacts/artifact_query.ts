import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const artifact_query = defineTool({
  description: "Query Turborepo artifact events and usage statistics by hashes.",
  access: { risk: "read" },
  input: z.strictObject({
    hashes: z.array(z.string()).min(1),
  }),
  execute: async ({ hashes }) => {
    const result = await vercel().artifacts.artifactQuery({
      ...TEAM,
      requestBody: { hashes },
    });
    return JSON.stringify(result);
  },
});
