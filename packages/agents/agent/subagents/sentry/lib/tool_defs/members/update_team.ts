import { updateATeam, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

const updateTeamBodySchema = z.object({ name: z.string().optional(), slug: z.string() });

export const update_team = defineTool({
  description: "Update a Sentry team's name or slug.",
  access: { risk: "write", minRole: "admin" },
  input: z.strictObject({
    team_slug: z.string().describe("Current team slug"),
    name: z.string().optional().describe("New team name"),
    slug: z.string().optional().describe("New team slug"),
  }),
  execute: async ({ team_slug, name, slug }) => {
    const body = updateTeamBodySchema.parse({ name, slug: slug ?? team_slug });
    const result = await updateATeam({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
      body,
    });
    const { data } = unwrapResult(result, "updateTeam");
    return JSON.stringify(data);
  },
});
