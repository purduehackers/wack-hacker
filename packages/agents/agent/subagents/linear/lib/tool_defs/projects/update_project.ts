import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const update_project = defineTool({
  description:
    "Update a project by ID. Only include fields to change — omitted fields are left unchanged.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    name: z.string().exactOptional(),
    description: z.string().exactOptional(),
    content: z.string().exactOptional().describe("Markdown body"),
    leadId: z.string().exactOptional(),
    memberIds: z.array(z.string()).exactOptional(),
    targetDate: z.iso.date().exactOptional().describe("ISO date"),
    startDate: z.iso.date().exactOptional().describe("ISO date"),
    priority: z
      .literal([0, 1, 2, 3, 4])
      .exactOptional()
      .describe("0=None, 1=Urgent, 2=High, 3=Normal, 4=Low"),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateProject(id, input);
    const project = await payload.project;
    if (!project) return "Failed to update project";
    return JSON.stringify({ id: project.id, name: project.name, url: project.url });
  },
});
