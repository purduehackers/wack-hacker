import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, username } from "../../constants.ts";

export const invite_org_member = defineTool({
  description: `Invite a GitHub user to the purduehackers organization or update their role. Role can be "admin" or "member" (default).`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    username: username.describe("GitHub username to invite"),
    role: z.enum(["admin", "member"]).optional().describe("Org role (default: member)"),
  }),
  execute: async ({ username, role }) => {
    const { data } = await octokit().rest.orgs.setMembershipForUser({
      org: env.GITHUB_ORG,
      username,
      role: role ?? "member",
    });
    return JSON.stringify({
      user: data.user?.login,
      role: data.role,
      state: data.state,
    });
  },
});
