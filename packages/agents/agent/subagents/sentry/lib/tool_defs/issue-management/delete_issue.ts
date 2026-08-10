import { removeAnIssue, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const delete_issue = defineTool({
  description: "Permanently delete a Sentry issue. This action cannot be undone.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    issue_id: sentryNumericId.describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    const result = await removeAnIssue({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id,
      },
    });
    unwrapResult(result, "deleteIssue");
    return JSON.stringify({ deleted: true });
  },
});
