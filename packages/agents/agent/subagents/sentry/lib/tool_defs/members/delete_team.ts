import { deleteATeam, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const delete_team = defineTool({
  description: "Permanently delete a Sentry team. This action cannot be undone.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    team_slug: z.string().describe("Team slug"),
  }),
  execute: async ({ team_slug }) => {
    const result = await deleteATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
    });
    unwrapResult(result, "deleteTeam");
    return JSON.stringify({ deleted: true });
  },
});
