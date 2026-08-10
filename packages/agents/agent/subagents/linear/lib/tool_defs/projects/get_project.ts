import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const get_project = defineTool({
  description:
    "Get a single project's details by ID — name, status, description, progress, lead, target/start dates, and URL.",
  access: { risk: "read" },
  input: z.strictObject({ id: z.string().describe("Project UUID") }),
  execute: async ({ id }) => {
    const project = await linear.project(id);
    return JSON.stringify({
      id: project.id,
      name: project.name,
      description: project.description,
      state: project.state,
      progress: project.progress,
      startDate: project.startDate,
      targetDate: project.targetDate,
      url: project.url,
    });
  },
});
