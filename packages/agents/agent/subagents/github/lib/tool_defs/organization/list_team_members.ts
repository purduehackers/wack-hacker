import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape, teamSlug } from "../../constants.ts";

export const list_team_members = defineTool({
  description: `List members of a team. Optionally filter by role (all, member, maintainer). Returns login, ID, and profile URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    team_slug: teamSlug,
    role: z.enum(["all", "member", "maintainer"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ team_slug, role, per_page, page }) => {
    const { data } = await octokit().rest.teams.listMembersInOrg({
      org: env.GITHUB_ORG,
      team_slug,
      role: role ?? "all",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(data.map((m) => ({ login: m.login, id: m.id, html_url: m.html_url })));
  },
});
