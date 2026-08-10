import { retrieveATeam, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const get_team = defineTool({
  description: "Get full details for a Sentry team by slug.",
  access: { risk: "read" },
  input: z.strictObject({
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ team_slug }) => {
    const result = await retrieveATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
    });
    const { data } = unwrapResult(result, "getTeam");
    return JSON.stringify(data);
  },
});
