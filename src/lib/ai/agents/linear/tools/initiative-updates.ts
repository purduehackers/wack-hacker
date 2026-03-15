import { tool } from "ai";
import { z } from "zod";

import { linear } from "../client";
import { healthSchema } from "../constants";

const json = JSON.stringify;

export const query_initiative_updates = tool({
  description: "List recent initiative status updates with body, health, date, and URL.",
  inputSchema: z.object({
    initiativeId: z.string(),
    first: z.number().optional().default(10),
  }),
  execute: async ({ initiativeId, first }) => {
    const initiative = await linear.initiative(initiativeId);
    const updates = await initiative.initiativeUpdates({ first });
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

export const create_initiative_update = tool({
  description:
    "Create an initiative status update with Markdown body and health (onTrack/atRisk/offTrack). For cross-project reporting.",
  inputSchema: z.object({
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
    return json({ id: update.id, url: update.url });
  },
});

export const update_initiative_update = tool({
  description: "Edit an existing initiative update's body or health status.",
  inputSchema: z.object({
    id: z.string(),
    body: z.string().optional(),
    health: healthSchema,
    isDiffHidden: z.boolean().optional(),
  }),
  execute: async ({ id, health, ...rest }) => {
    const payload = await linear.updateInitiativeUpdate(id, { ...rest, health: health as any });
    const update = await payload.initiativeUpdate;
    if (!update) return "Failed to update initiative update";
    return json({ id: update.id, url: update.url });
  },
});
