import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, teamSlug, username } from "../../constants.ts";

export const add_team_member = defineTool({
  description: `Add a user to a team or update their team role. Role can be "member" (default) or "maintainer".`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    team_slug: teamSlug,
    username,
    role: z.enum(["member", "maintainer"]).optional().describe("Team role (default: member)"),
  }),
  execute: async ({ team_slug, username, role }) => {
    const { data } = await octokit().rest.teams.addOrUpdateMembershipForUserInOrg({
      org: env.GITHUB_ORG,
      team_slug,
      username,
      role: role ?? "member",
    });
    return JSON.stringify({ username, role: data.role, state: data.state });
  },
});
