import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const delete_issue = defineTool({
  description:
    "Permanently delete an issue by ID. Only use when the user explicitly asks to delete.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string() }),
  execute: async ({ id }) => {
    const payload = await linear.deleteIssue(id);
    return JSON.stringify({ success: payload.success });
  },
});
