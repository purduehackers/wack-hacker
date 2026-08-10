import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const add_user_to_team = defineTool({
  description:
    "Add a user to a Linear team. Resolve user and team IDs first via list_users and suggest_property_values.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    team_id: z.string().describe("Team UUID"),
    user_id: z.string().describe("User UUID to add"),
  }),
  execute: async ({ team_id, user_id }) => {
    const payload = await linear.createTeamMembership({
      teamId: team_id,
      userId: user_id,
    });
    const membership = await payload.teamMembership;
    return JSON.stringify({
      success: payload.success,
      // oxlint-disable-next-line unicorn/no-null -- Linear absence is part of the tool output
      membershipId: membership?.id ?? null,
      teamId: team_id,
      userId: user_id,
    });
  },
});
