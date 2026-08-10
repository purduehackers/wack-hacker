import { InitiativeStatus } from "@linear/sdk";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";

const initiativeStatusSchema = z.enum(InitiativeStatus);

export const create_initiative = defineTool({
  description:
    "Create an initiative (strategic goal grouping multiple projects). Supports owner, status (Planned/Active/Completed), target date, and Markdown content.",
  access: { risk: "write" },
  input: z.strictObject({
    name: z.string(),
    description: z.string().exactOptional(),
    content: z.string().exactOptional().describe("Markdown"),
    ownerId: z.string().exactOptional(),
    status: initiativeStatusSchema.exactOptional(),
    targetDate: z.iso.date().exactOptional().describe("ISO date"),
  }),
  execute: async (input) => {
    const payload = await linear.createInitiative(input);
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to create initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});

export const update_initiative = defineTool({
  description: "Update an initiative by ID. Only include fields to change.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    name: z.string().exactOptional(),
    description: z.string().exactOptional(),
    content: z.string().exactOptional().describe("Markdown"),
    ownerId: z.string().exactOptional(),
    status: initiativeStatusSchema.exactOptional(),
    targetDate: z.iso.date().exactOptional().describe("ISO date"),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateInitiative(id, input);
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to update initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});

export const list_initiatives = defineTool({
  description: "List all initiatives with name, status, target date, and URL.",
  access: { risk: "read" },
  input: z.strictObject({}),
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

export const query_initiative_activity = defineTool({
  description: "Fetch an initiative's change history (status changes, owner changes, etc.).",
  access: { risk: "read" },
  input: z.strictObject({ id: z.string() }),
  execute: async ({ id }) => {
    const initiative = await linear.initiative(id);
    const history = await initiative.history();
    return JSON.stringify({
      history: history.nodes.map((h) => ({ id: h.id, createdAt: h.createdAt })),
    });
  },
});
