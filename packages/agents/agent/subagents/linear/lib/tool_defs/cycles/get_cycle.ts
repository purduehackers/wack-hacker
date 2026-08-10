import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const get_cycle = defineTool({
  description: "Get a single cycle's full details by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: z.string().describe("Cycle UUID") }),
  execute: async ({ id }) => {
    const c = await linear.cycle(id);
    return JSON.stringify({
      id: c.id,
      number: c.number,
      name: c.name,
      description: c.description,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      completedAt: c.completedAt,
      progress: c.progress,
    });
  },
});
