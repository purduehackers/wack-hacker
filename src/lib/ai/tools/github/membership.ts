import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { admin } from "../../skills/index.ts";
import { octokit } from "./client.ts";

// destructive
export const add_member_to_platform = admin(
  tool({
    description:
      "Invite a GitHub user to the purduehackers organization. Default role is 'member'. If the user already belongs, updates their role instead. Returns state (active or pending).",
    inputSchema: z.object({
      username: z.string().describe("GitHub username to invite"),
      role: z.enum(["admin", "member"]).optional().describe("Organization role (default: member)"),
    }),
    execute: async ({ username, role }) => {
      const { data } = await octokit.rest.orgs.setMembershipForUser({
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
  }),
);

// destructive
export const remove_member_from_platform = admin(
  tool({
    description:
      "Remove a user from the purduehackers organization. Revokes all their access to org repos. This does not delete their GitHub account, only their org membership.",
    inputSchema: z.object({
      username: z.string().describe("GitHub username to remove"),
    }),
    execute: async ({ username }) => {
      await octokit.rest.orgs.removeMembershipForUser({
        org: env.GITHUB_ORG,
        username,
      });
      return JSON.stringify({ removed: true, username });
    },
  }),
);
