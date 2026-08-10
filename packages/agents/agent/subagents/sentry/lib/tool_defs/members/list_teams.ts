import { listAnOrganization_sTeams, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_teams = defineTool({
  description:
    "List teams in the Sentry organization. Returns slug, name, member count, and date created.",
  access: { risk: "read" },
  input: z.strictObject({
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ cursor }) => {
    const result = await listAnOrganization_sTeams({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listTeams");
    return JSON.stringify(
      data.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        dateCreated: t.dateCreated,
        memberCount: t.memberCount,
      })),
    );
  },
});
