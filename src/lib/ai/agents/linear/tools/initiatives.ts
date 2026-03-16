import { tool } from "ai";
import { z } from "zod";

import { linear } from "../client";

export const create_initiative = tool({
  description:
    "Create an initiative (strategic goal grouping multiple projects). Supports owner, status (Planned/Active/Completed), target date, and Markdown content.",
  inputSchema: z.object({
    name: z.string(),
    description: z.string().optional(),
    content: z.string().optional().describe("Markdown"),
    ownerId: z.string().optional(),
    status: z.enum(["Planned", "Active", "Completed"]).optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async ({ status, ...rest }) => {
    const payload = await linear.createInitiative({ ...rest, status: status as any });
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to create initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});

export const update_initiative = tool({
  description: "Update an initiative by ID. Only include fields to change.",
  inputSchema: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    content: z.string().optional().describe("Markdown"),
    ownerId: z.string().optional(),
    status: z.enum(["Planned", "Active", "Completed"]).optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async ({ id, status, ...rest }) => {
    const payload = await linear.updateInitiative(id, { ...rest, status: status as any });
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to update initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});

export const list_initiatives = tool({
  description: "List all initiatives with name, status, target date, and URL.",
  inputSchema: z.object({}),
  execute: async () => {
    const r = await linear.initiatives();
    return JSON.stringify(
      r.nodes.map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        targetDate: i.targetDate,
        url: i.url,
      })),
    );
  },
});

export const query_initiative_activity = tool({
  description: "Fetch an initiative's change history (status changes, owner changes, etc.).",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const initiative = await linear.initiative(id);
    const history = await initiative.history();
    return JSON.stringify({
      history: history.nodes.map((h) => ({ id: h.id, createdAt: h.createdAt })),
    });
  },
});
