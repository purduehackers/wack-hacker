import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const unarchive_issue = defineTool({
  description: "Restore an archived issue back to its previous state.",
  access: { risk: "write" },
  input: z.strictObject({ id: z.string().describe("Issue UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.unarchiveIssue(id);
    return JSON.stringify({ success: payload.success });
  },
});
