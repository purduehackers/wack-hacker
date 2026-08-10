import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const archive_project = defineTool({
  description:
    "Archive a project. Archived projects are hidden from default views but preserved. Prefer this over delete_project.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.archiveProject(id);
    return JSON.stringify({ success: payload.success });
  },
});
