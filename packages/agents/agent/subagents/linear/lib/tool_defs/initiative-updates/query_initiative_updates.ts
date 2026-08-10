import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

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
