import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "../../constants.ts";

export const list_team_members = defineTool({
  description: "List members of the active team.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: pageLimit.optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    role: z.enum(["OWNER", "MEMBER", "DEVELOPER", "VIEWER", "BILLING", "CONTRIBUTOR"]).optional(),
    excludeProject: z.string().optional(),
    eligibleMembersForProjectId: z.string().optional(),
    search: z.string().optional(),
  }),
  execute: async ({
    limit,
    since,
    until,
    role,
    excludeProject,
    eligibleMembersForProjectId,
    search,
  }) => {
    const result = await vercel().teams.getTeamMembers({
      teamId: VERCEL_TEAM_ID,
      slug: VERCEL_TEAM_SLUG,
      limit,
      since,
      until,
      role,
      excludeProject,
      eligibleMembersForProjectId,
      search,
    });
    return JSON.stringify(result);
  },
});
