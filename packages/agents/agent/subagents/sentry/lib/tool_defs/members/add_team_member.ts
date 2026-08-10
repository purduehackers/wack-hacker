import { addAnOrganizationMemberToATeam, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const add_team_member = defineTool({
  description: "Add an organization member to a Sentry team.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    member_id: z.string().describe("Organization member ID"),
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ member_id, team_slug }) => {
    const result = await addAnOrganizationMemberToATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
        team_id_or_slug: team_slug,
      },
    });
    const { data } = unwrapResult(result, "addTeamMember");
    return JSON.stringify(data);
  },
});
