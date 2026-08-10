import { listAnOrganization_sMembers, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { memberProjectionSchema } from "../../constants.ts";

export const list_members = defineTool({
  description:
    "List members in the Sentry organization. Returns name, email, role, pending status, and team slugs.",
  access: { risk: "read" },
  input: z.strictObject({
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ cursor }) => {
    const result = await listAnOrganization_sMembers({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listMembers");
    return JSON.stringify(
      data.map((member) => {
        const projection = memberProjectionSchema.parse(member);
        return {
          id: member.id,
          email: member.email,
          name: member.name,
          role: projection.role,
          roleName: projection.roleName,
          pending: member.pending,
          expired: member.expired,
          dateCreated: member.dateCreated,
          username: member.user?.username,
          teams: projection.teams,
        };
      }),
    );
  },
});
