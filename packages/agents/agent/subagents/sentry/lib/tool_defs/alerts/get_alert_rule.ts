import { deprecatedRetrieveAnIssueAlertRuleForAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const get_alert_rule = defineTool({
  description: "Get full details for a Sentry issue alert rule, including conditions and actions.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    rule_id: sentryNumericId.describe("Alert rule ID"),
  }),
  execute: async ({ project_slug, rule_id }) => {
    const result = await deprecatedRetrieveAnIssueAlertRuleForAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        rule_id: Number(rule_id),
      },
    });
    const { data } = unwrapResult(result, "getAlertRule");
    return JSON.stringify(data);
  },
});
