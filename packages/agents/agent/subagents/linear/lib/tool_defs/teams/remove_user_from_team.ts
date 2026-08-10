import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const remove_user_from_team = defineTool({
  description:
    "Remove a user from a Linear team. Resolve user and team IDs first via list_users and suggest_property_values.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    team_id: z.string().describe("Team UUID"),
    user_id: z.string().describe("User UUID to remove"),
  }),
  execute: async ({ team_id, user_id }) => {
    const user = await linear.user(user_id);
    const memberships = await user.teamMemberships();

    const teams = await Promise.all(memberships.nodes.map(async (m) => m.team));
    const idx = teams.findIndex((t) => t?.id === team_id);
    if (idx === -1) {
      return JSON.stringify({ error: "User is not a member of this team" });
    }

    const selected = memberships.nodes[idx];
    if (selected === undefined) return JSON.stringify({ error: "Team membership disappeared" });
    const payload = await linear.deleteTeamMembership(selected.id);
    return JSON.stringify({ success: payload.success });
  },
});
