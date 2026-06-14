import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { linear } from "./client.ts";
import { healthSchema } from "./constants.ts";

export const query_initiative_updates = defineTool({
  name: "query_initiative_updates",
  domain: "linear",
  description: "List recent initiative status updates with body, health, date, and URL.",
  access: { risk: "read" },
  input: z.object({
    initiativeId: z.string(),
    first: z.number().optional().default(10),
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
  name: "create_initiative_update",
  domain: "linear",
  description:
    "Create an initiative status update with Markdown body and health (onTrack/atRisk/offTrack). For cross-project reporting.",
  access: { risk: "write" },
  input: z.object({
    initiativeId: z.string(),
    body: z.string().optional().describe("Markdown"),
    health: healthSchema,
    isDiffHidden: z.boolean().optional(),
  }),
  execute: async ({ initiativeId, body, health, isDiffHidden }) => {
    const payload = await linear.createInitiativeUpdate({
      initiativeId,
      body,
      isDiffHidden,
      health: health as any,
    });
    const update = await payload.initiativeUpdate;
    if (!update) return "Failed to create initiative update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});

export const update_initiative_update = defineTool({
  name: "update_initiative_update",
  domain: "linear",
  description: "Edit an existing initiative update's body or health status.",
  access: { risk: "write" },
  input: z.object({
    id: z.string(),
    body: z.string().optional(),
    health: healthSchema,
    isDiffHidden: z.boolean().optional(),
  }),
  execute: async ({ id, health, ...rest }) => {
    const payload = await linear.updateInitiativeUpdate(id, { ...rest, health: health as any });
    const update = await payload.initiativeUpdate;
    if (!update) return "Failed to update initiative update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});
