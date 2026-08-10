import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const archive_cycle = defineTool({
  description:
    "Archive a cycle. Cycles cannot be hard-deleted in Linear — archiving is the closest equivalent.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string().describe("Cycle UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.archiveCycle(id);
    return JSON.stringify({ success: payload.success });
  },
});
