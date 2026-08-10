import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const list_sandbox_snapshots = defineTool({
  description: "List snapshots captured across the team's sandboxes.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: pageLimit.optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
  }),
  execute: async (input) => {
    const result = await vercel().sandboxes.listSnapshots({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
