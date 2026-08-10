import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const delete_project = defineTool({
  description: "Permanently delete a project. Irreversible — prefer archive_project.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.deleteProject(id);
    return JSON.stringify({ success: payload.success });
  },
});
