import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const delete_label = defineTool({
  description:
    "Delete a label. This removes it from all issues. Irreversible — always confirm with the user.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string().describe("Label UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.deleteIssueLabel(id);
    return JSON.stringify({ success: payload.success });
  },
});
