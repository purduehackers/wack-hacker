import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_domains = defineTool({
  description: "List all apex domains registered to the active team.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
  }),
  execute: async (input) => {
    const result = await vercel().domains.getDomains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
