import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const list_team_members = defineTool({
  description:
    "List all members of a Linear team. Returns name, display name, email, admin flag, and active status.",
  access: { risk: "read" },
  input: z.strictObject({
    team_id: z.string().describe("Team UUID"),
  }),
  execute: async ({ team_id }) => {
    const team = await linear.team(team_id);
    const members = await team.members();
    return JSON.stringify(
      members.nodes.map((u) => ({
        id: u.id,
        name: u.name,
        displayName: u.displayName,
        email: u.email,
        admin: u.admin,
        active: u.active,
      })),
    );
  },
});
