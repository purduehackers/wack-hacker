import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, teamSlug, username } from "../../constants.ts";

export const remove_team_member = defineTool({
  description: `Remove a user from a team. They keep org membership but lose team-specific repo access.`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    team_slug: teamSlug,
    username,
  }),
  execute: async ({ team_slug, username }) => {
    await octokit().rest.teams.removeMembershipForUserInOrg({
      org: env.GITHUB_ORG,
      team_slug,
      username,
    });
    return JSON.stringify({ removed: true, team_slug, username });
  },
});
