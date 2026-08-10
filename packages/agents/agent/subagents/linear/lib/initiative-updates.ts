import { InitiativeUpdateHealthType } from "@linear/sdk";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";

const healthSchema = z.enum(InitiativeUpdateHealthType).exactOptional();

export const query_initiative_updates = defineTool({
  description: "List recent initiative status updates with body, health, date, and URL.",
  access: { risk: "read" },
  input: z.strictObject({
    initiativeId: z.string(),
    first: z.int().min(1).default(10),
  }),
  execute: async ({ initiativeId, first }) => {
    const initiative = await linear.initiative(initiativeId);
    const updates = await initiative.initiativeUpdates({ first });
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

export const create_initiative_update = defineTool({
  description:
    "Create an initiative status update with Markdown body and health (onTrack/atRisk/offTrack). For cross-project reporting.",
  access: { risk: "write" },
  input: z.strictObject({
    initiativeId: z.string(),
    body: z.string().exactOptional().describe("Markdown"),
    health: healthSchema,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async (input) => {
    const payload = await linear.createInitiativeUpdate(input);
    const update = await payload.initiativeUpdate;
    if (!update) return "Failed to create initiative update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});

export const update_initiative_update = defineTool({
  description: "Edit an existing initiative update's body or health status.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    body: z.string().exactOptional(),
    health: healthSchema,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateInitiativeUpdate(id, input);
    const update = await payload.initiativeUpdate;
    if (!update) return "Failed to update initiative update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});
