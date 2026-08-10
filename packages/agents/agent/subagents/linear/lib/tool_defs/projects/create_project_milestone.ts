import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const create_project_milestone = defineTool({
  description:
    "Create a milestone inside a project. Milestones mark key deliverables within a project timeline.",
  access: { risk: "write" },
  input: z.strictObject({
    projectId: z.string(),
    name: z.string(),
    description: z.string().exactOptional(),
    targetDate: z.iso.date().exactOptional().describe("ISO date"),
  }),
  execute: async (input) => {
    const payload = await linear.createProjectMilestone(input);
    const milestone = await payload.projectMilestone;
    if (!milestone) return "Failed to create milestone";
    return JSON.stringify({ id: milestone.id, name: milestone.name });
  },
});
