import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const query_project_updates = defineTool({
  description:
    "List recent project status updates with body, health, date, and URL. Pull prior updates before drafting a new one to match tone.",
  access: { risk: "read" },
  input: z.strictObject({
    projectId: z.string(),
    first: z.int().min(1).default(10),
  }),
  execute: async ({ projectId, first }) => {
    const project = await linear.project(projectId);
    const updates = await project.projectUpdates({ first });
    return JSON.stringify(
      updates.nodes.map((u) => ({
        id: u.id,
        body: u.body?.slice(0, 1000),
        health: u.health,
        createdAt: u.createdAt,
        url: u.url,
      })),
    );
  },
});
