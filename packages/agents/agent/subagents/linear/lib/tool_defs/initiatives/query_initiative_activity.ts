import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

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
