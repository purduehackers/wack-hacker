import { retrieveAnOrganizationMember, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { memberProjectionSchema } from "../../constants.ts";

export const get_member = defineTool({
  description: "Get full details for a Sentry organization member by their member ID.",
  access: { risk: "read" },
  input: z.strictObject({
    member_id: z.string().describe("Member ID"),
  }),
  execute: async ({ member_id }) => {
    const result = await retrieveAnOrganizationMember({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
      },
    });
    const { data } = unwrapResult(result, "getMember");
    const d = data;
    const projection = memberProjectionSchema.parse(data);
    return JSON.stringify({
      id: d.id,
      email: d.email,
      name: d.name,
      role: projection.role,
      roleName: projection.roleName,
      pending: d.pending,
      expired: d.expired,
      dateCreated: d.dateCreated,
      user: d.user,
      teams: projection.teams,
    });
  },
});
