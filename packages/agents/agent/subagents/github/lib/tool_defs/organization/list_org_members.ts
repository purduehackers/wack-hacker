import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape } from "../../constants.ts";

export const list_org_members = defineTool({
  description: `List members of the purduehackers organization. Optionally filter by role (all, admin, member). Returns login, ID, avatar URL, and profile URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    role: z.enum(["all", "admin", "member"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ role, per_page, page }) => {
    const { data } = await octokit().rest.orgs.listMembers({
      org: env.GITHUB_ORG,
      role: role ?? "all",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((m) => ({
        login: m.login,
        id: m.id,
        avatar_url: m.avatar_url,
        html_url: m.html_url,
      })),
    );
  },
});
