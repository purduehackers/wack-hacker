import { deleteAnOrganizationMemberFromATeam, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const remove_team_member = defineTool({
  description: "Remove a member from a Sentry team.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    member_id: z.string().describe("Organization member ID"),
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ member_id, team_slug }) => {
    const result = await deleteAnOrganizationMemberFromATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
        team_id_or_slug: team_slug,
      },
    });
    unwrapResult(result, "removeTeamMember");
    return JSON.stringify({ removed: true });
  },
});
