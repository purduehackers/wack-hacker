import { deleteAnOrganizationMember, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const remove_member_from_platform = defineTool({
  description:
    "Remove a member from the Sentry organization by their member ID. Resolve the member ID via list_members first — never remove on ambiguous input.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    member_id: z.string().describe("Sentry member ID (not the user's email)"),
  }),
  execute: async ({ member_id }) => {
    const result = await deleteAnOrganizationMember({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        member_id,
      },
    });
    unwrapResult(result, "removeMember");
    return JSON.stringify({ removed: true, member_id });
  },
});
