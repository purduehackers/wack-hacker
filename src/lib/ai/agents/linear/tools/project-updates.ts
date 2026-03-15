import { tool } from "ai";
import { z } from "zod";

import { linear } from "../client";
import { healthSchema } from "../constants";

const json = JSON.stringify;

export const query_project_updates = tool({
  description:
    "List recent project status updates with body, health, date, and URL. Pull prior updates before drafting a new one to match tone.",
  inputSchema: z.object({
    projectId: z.string(),
    first: z.number().optional().default(10),
  }),
  execute: async ({ projectId, first }) => {
    const project = await linear.project(projectId);
    const updates = await project.projectUpdates({ first });
    return json(
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

export const create_project_update = tool({
  description:
    "Create a project status update with Markdown body and health (onTrack/atRisk/offTrack). Draft in chat first unless the user says to post immediately.",
  inputSchema: z.object({
    projectId: z.string(),
    body: z.string().optional().describe("Markdown"),
    health: healthSchema,
    isDiffHidden: z.boolean().optional(),
  }),
  execute: async ({ projectId, body, health, isDiffHidden }) => {
    const payload = await linear.createProjectUpdate({
      projectId,
      body,
      isDiffHidden,
      health: health as any,
    });
    const update = await payload.projectUpdate;
    if (!update) return "Failed to create project update";
    return json({ id: update.id, url: update.url });
  },
});

export const update_project_update = tool({
  description: "Edit an existing project update's body or health status.",
  inputSchema: z.object({
    id: z.string(),
    body: z.string().optional(),
    health: healthSchema,
    isDiffHidden: z.boolean().optional(),
  }),
  execute: async ({ id, health, ...rest }) => {
    const payload = await linear.updateProjectUpdate(id, { ...rest, health: health as any });
    const update = await payload.projectUpdate;
    if (!update) return "Failed to update project update";
    return json({ id: update.id, url: update.url });
  },
});
