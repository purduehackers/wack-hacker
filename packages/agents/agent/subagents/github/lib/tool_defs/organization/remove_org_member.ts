import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, username } from "../../constants.ts";

export const remove_org_member = defineTool({
  description: `Remove a user from the purduehackers organization. This revokes all their access to org repos.`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    username: username.describe("GitHub username to remove"),
  }),
  execute: async ({ username }) => {
    await octokit().rest.orgs.removeMembershipForUser({
      org: env.GITHUB_ORG,
      username,
    });
    return JSON.stringify({ removed: true, username });
  },
});
