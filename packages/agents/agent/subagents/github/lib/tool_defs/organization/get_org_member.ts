import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, username } from "../../constants.ts";

export const get_org_member = defineTool({
  description: `Get organization membership details for a GitHub user. Returns role (admin or member) and state (active or pending).`,
  access: { risk: "read" },
  input: z.strictObject({
    username,
  }),
  execute: async ({ username }) => {
    const { data } = await octokit().rest.orgs.getMembershipForUser({
      org: env.GITHUB_ORG,
      username,
    });
    return JSON.stringify({
      user: data.user?.login,
      role: data.role,
      state: data.state,
    });
  },
});
