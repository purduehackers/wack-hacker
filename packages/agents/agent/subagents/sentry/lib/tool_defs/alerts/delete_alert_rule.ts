import { deprecatedDeleteAnIssueAlertRule, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const delete_alert_rule = defineTool({
  description: "Permanently delete a Sentry issue alert rule. This action cannot be undone.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    rule_id: sentryNumericId.describe("Alert rule ID"),
  }),
  execute: async ({ project_slug, rule_id }) => {
    const result = await deprecatedDeleteAnIssueAlertRule({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        rule_id: Number(rule_id),
      },
    });
    unwrapResult(result, "deleteAlertRule");
    return JSON.stringify({ deleted: true });
  },
});
