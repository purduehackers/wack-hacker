import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const create_cycle = defineTool({
  description:
    "Create a new cycle for a team. Dates are ISO 8601. Name is optional and defaults to a generated name.",
  access: { risk: "write" },
  input: z.strictObject({
    team_id: z.string().describe("Team UUID"),
    name: z.string().exactOptional(),
    description: z.string().exactOptional(),
    starts_at: z.iso.datetime({ offset: true }).describe("ISO 8601 start"),
    ends_at: z.iso.datetime({ offset: true }).describe("ISO 8601 end"),
  }),
  execute: async ({ team_id, starts_at, ends_at, ...rest }) => {
    const payload = await linear.createCycle({
      teamId: team_id,
      startsAt: new Date(starts_at),
      endsAt: new Date(ends_at),
      ...rest,
    });
    const cycle = await payload.cycle;
    if (!cycle) return JSON.stringify({ error: "Failed to create cycle" });
    return JSON.stringify({ id: cycle.id, number: cycle.number, name: cycle.name });
  },
});
