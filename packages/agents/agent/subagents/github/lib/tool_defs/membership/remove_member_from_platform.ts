import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env } from "../../constants.ts";

export const remove_member_from_platform = defineTool({
  description:
    "Remove a user from the purduehackers organization. Revokes all their access to org repos. This does not delete their GitHub account, only their org membership.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    username: z.string().min(1).describe("GitHub username to remove"),
  }),
  execute: async ({ username }) => {
    await octokit().rest.orgs.removeMembershipForUser({
      org: env.GITHUB_ORG,
      username,
    });
    return JSON.stringify({ removed: true, username });
  },
});
