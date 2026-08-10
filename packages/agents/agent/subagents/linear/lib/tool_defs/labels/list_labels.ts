import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { NO_TEAM } from "../../constants.ts";

export const list_labels = defineTool({
  description:
    "List issue labels across the Linear workspace. Optionally filter by team. Returns ID, name, color, and team.",
  access: { risk: "read" },
  input: z.strictObject({
    team_id: z.string().optional().describe("Filter to labels for this team UUID"),
    first: z.int().min(1).max(100).optional().describe("Max results"),
  }),
  execute: async ({ team_id, first }) => {
    const labels = team_id
      ? await (await linear.team(team_id)).labels({ first: first ?? 50 })
      : await linear.issueLabels({ first: first ?? 50 });
    const results = await Promise.all(
      labels.nodes.map(async (l) => {
        const team = l.team ? await l.team : undefined;
        return {
          id: l.id,
          name: l.name,
          color: l.color,
          description: l.description,
          team: team ? { id: team.id, name: team.name } : NO_TEAM,
        };
      }),
    );
    return JSON.stringify(results);
  },
});
