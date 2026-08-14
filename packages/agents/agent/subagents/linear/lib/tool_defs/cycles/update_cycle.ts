import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const update_cycle = defineTool({
  description: "Update a cycle's name, description, or dates.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string().describe("Cycle UUID"),
    name: z.string().exactOptional(),
    description: z.string().exactOptional(),
    starts_at: z.iso.datetime({ offset: true }).exactOptional().describe("ISO 8601 start"),
    ends_at: z.iso.datetime({ offset: true }).exactOptional().describe("ISO 8601 end"),
  }),
  execute: async ({ id, starts_at, ends_at, ...rest }) => {
    const payload = await linear.updateCycle(id, {
      ...rest,
      ...(starts_at !== undefined && { startsAt: new Date(starts_at) }),
      ...(ends_at !== undefined && { endsAt: new Date(ends_at) }),
    });
    const cycle = await payload.cycle;
    if (!cycle) return JSON.stringify({ error: "Failed to update cycle" });
    return JSON.stringify({ id: cycle.id, number: cycle.number, name: cycle.name });
  },
});
