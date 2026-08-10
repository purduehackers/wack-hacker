import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const list_cycles = defineTool({
  description:
    "List cycles (sprints) for a team or across the workspace. Returns ID, name, number, start/end dates, and completion stats.",
  access: { risk: "read" },
  input: z.strictObject({
    team_id: z.string().optional().describe("Filter to cycles for this team UUID"),
    first: z.int().min(1).max(100).optional(),
  }),
  execute: async ({ team_id, first }) => {
    const cycles = team_id
      ? await (await linear.team(team_id)).cycles({ first: first ?? 25 })
      : await linear.cycles({ first: first ?? 25 });
    return JSON.stringify(
      cycles.nodes.map((c) => ({
        id: c.id,
        number: c.number,
        name: c.name,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        completedAt: c.completedAt,
        progress: c.progress,
      })),
    );
  },
});
