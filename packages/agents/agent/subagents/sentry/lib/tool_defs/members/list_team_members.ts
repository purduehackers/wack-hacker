import { listATeam_sMembers, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_team_members = defineTool({
  description: "List members of a Sentry team.",
  access: { risk: "read" },
  input: z.strictObject({
    team_slug: z.string().describe("Team slug"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ team_slug, cursor }) => {
    const result = await listATeam_sMembers({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listTeamMembers");
    return JSON.stringify(
      data.map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        username: m.user?.username,
      })),
    );
  },
});
