import { InitiativeStatus } from "@linear/sdk";
import { z } from "zod";

const INITIATIVE_STATUS: Record<"Planned" | "Active" | "Completed", InitiativeStatus> = {
  Planned: InitiativeStatus.Planned,
  Active: InitiativeStatus.Active,
  Completed: InitiativeStatus.Completed,
};

import { linear } from "./client.ts";
import { defineTool } from "./define-tool.ts";
import { sdkInput } from "./sdk-input.ts";

export const create_initiative = defineTool({
  name: "create_initiative",
  domain: "linear",
  description:
    "Create an initiative (strategic goal grouping multiple projects). Supports owner, status (Planned/Active/Completed), target date, and Markdown content.",
  access: { risk: "write" },
  input: z.object({
    name: z.string(),
    description: z.string().optional(),
    content: z.string().optional().describe("Markdown"),
    ownerId: z.string().optional(),
    status: z.enum(["Planned", "Active", "Completed"]).optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async ({ status, ...rest }) => {
    const payload = await linear.createInitiative(
      sdkInput<Parameters<typeof linear.createInitiative>[0]>({
        ...rest,
        status: status === undefined ? undefined : INITIATIVE_STATUS[status],
      }),
    );
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to create initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});

export const update_initiative = defineTool({
  name: "update_initiative",
  domain: "linear",
  description: "Update an initiative by ID. Only include fields to change.",
  access: { risk: "write" },
  input: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    content: z.string().optional().describe("Markdown"),
    ownerId: z.string().optional(),
    status: z.enum(["Planned", "Active", "Completed"]).optional(),
    targetDate: z.string().optional().describe("ISO date"),
  }),
  execute: async ({ id, status, ...rest }) => {
    const payload = await linear.updateInitiative(
      id,
      sdkInput<Parameters<typeof linear.updateInitiative>[1]>({
        ...rest,
        status: status === undefined ? undefined : INITIATIVE_STATUS[status],
      }),
    );
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to update initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});

export const list_initiatives = defineTool({
  name: "list_initiatives",
  domain: "linear",
  description: "List all initiatives with name, status, target date, and URL.",
  access: { risk: "read" },
  input: z.object({}),
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
  name: "query_initiative_activity",
  domain: "linear",
  description: "Fetch an initiative's change history (status changes, owner changes, etc.).",
  access: { risk: "read" },
  input: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const initiative = await linear.initiative(id);
    const history = await initiative.history();
    return JSON.stringify({
      history: history.nodes.map((h) => ({ id: h.id, createdAt: h.createdAt })),
    });
  },
});
