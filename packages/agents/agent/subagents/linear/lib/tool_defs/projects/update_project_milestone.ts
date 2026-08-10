import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const update_project_milestone = defineTool({
  description: "Update a project milestone.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    name: z.string().exactOptional(),
    description: z.string().exactOptional(),
    targetDate: z.iso.date().exactOptional().describe("ISO date"),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateProjectMilestone(id, input);
    const milestone = await payload.projectMilestone;
    if (!milestone) return "Failed to update milestone";
    return JSON.stringify({ id: milestone.id, name: milestone.name });
  },
});
