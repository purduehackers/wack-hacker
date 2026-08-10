import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const create_project = defineTool({
  description:
    "Create a project. Requires name and at least one teamId. Supports lead, members, dates, priority, and Markdown content.",
  access: { risk: "write" },
  input: z.strictObject({
    name: z.string(),
    teamIds: z.array(z.string()).min(1),
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
  execute: async (input) => {
    const payload = await linear.createProject(input);
    const project = await payload.project;
    if (!project) return "Failed to create project";
    return JSON.stringify({ id: project.id, name: project.name, url: project.url });
  },
});
