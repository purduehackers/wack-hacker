import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const archive_issue = defineTool({
  description:
    "Archive an issue. Archived issues are hidden from default views but preserved. Prefer this over delete_issue for most cases.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string().describe("Issue UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.archiveIssue(id);
    return JSON.stringify({ success: payload.success });
  },
});
