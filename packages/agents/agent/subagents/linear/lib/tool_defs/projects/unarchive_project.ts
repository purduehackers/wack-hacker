import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const unarchive_project = defineTool({
  description: "Restore an archived project.",
  access: { risk: "write" },
  input: z.strictObject({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.unarchiveProject(id);
    return JSON.stringify({ success: payload.success });
  },
});
