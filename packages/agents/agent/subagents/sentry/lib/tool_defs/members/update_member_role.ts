import { updateAnOrganizationMember_sRoles, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const update_member_role = defineTool({
  description:
    "Update a Sentry organization member's role. Common roles: owner, manager, admin, member, billing.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    member_id: z.string().describe("Organization member ID"),
    role: z
      .enum(["owner", "manager", "admin", "member", "billing"])
      .describe("New organization role"),
  }),
  execute: async ({ member_id, role }) => {
    const result = await updateAnOrganizationMember_sRoles({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
      },
      body: { orgRole: role },
    });
    const { data } = unwrapResult(result, "updateMemberRole");
    return JSON.stringify(data);
  },
});
