import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { linear } from "./client.ts";

export const list_team_members = defineTool({
  name: "list_team_members",
  domain: "linear",
  description:
    "List all members of a Linear team. Returns name, display name, email, admin flag, and active status.",
  access: { risk: "read" },
  input: z.object({
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

export const add_user_to_team = defineTool({
  name: "add_user_to_team",
  domain: "linear",
  description:
    "Add a user to a Linear team. Resolve user and team IDs first via list_users and suggest_property_values.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
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
      membershipId: membership?.id ?? null,
      teamId: team_id,
      userId: user_id,
    });
  },
});

export const remove_user_from_team = defineTool({
  name: "remove_user_from_team",
  domain: "linear",
  description:
    "Remove a user from a Linear team. Resolve user and team IDs first via list_users and suggest_property_values.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
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

    const payload = await linear.deleteTeamMembership(memberships.nodes[idx]!.id);
    return JSON.stringify({ success: payload.success });
  },
});
