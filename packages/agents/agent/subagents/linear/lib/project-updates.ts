import { ProjectUpdateHealthType } from "@linear/sdk";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";

const healthSchema = z.enum(ProjectUpdateHealthType).exactOptional();

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

export const create_project_update = defineTool({
  description:
    "Create a project status update with Markdown body and health (onTrack/atRisk/offTrack). Draft in chat first unless the user says to post immediately.",
  access: { risk: "write" },
  input: z.strictObject({
    projectId: z.string(),
    body: z.string().exactOptional().describe("Markdown"),
    health: healthSchema,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async (input) => {
    const payload = await linear.createProjectUpdate(input);
    const update = await payload.projectUpdate;
    if (!update) return "Failed to create project update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});

export const update_project_update = defineTool({
  description: "Edit an existing project update's body or health status.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    body: z.string().exactOptional(),
    health: healthSchema,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateProjectUpdate(id, input);
    const update = await payload.projectUpdate;
    if (!update) return "Failed to update project update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});
