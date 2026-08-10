import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env } from "../../constants.ts";

export const add_member_to_platform = defineTool({
  description:
    "Invite a GitHub user to the purduehackers organization. Default role is 'member'. If the user already belongs, updates their role instead. Returns state (active or pending).",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    username: z.string().min(1).describe("GitHub username to invite"),
    role: z.enum(["admin", "member"]).optional().describe("Organization role (default: member)"),
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
