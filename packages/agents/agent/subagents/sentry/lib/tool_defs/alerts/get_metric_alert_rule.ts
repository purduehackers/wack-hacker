import { deprecatedRetrieveAMetricAlertRuleForAnOrganization, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const get_metric_alert_rule = defineTool({
  description:
    "Get full details for a Sentry metric alert rule, including triggers and thresholds.",
  access: { risk: "read" },
  input: z.strictObject({
    alert_rule_id: sentryNumericId.describe("Metric alert rule ID"),
  }),
  execute: async ({ alert_rule_id }) => {
    const result = await deprecatedRetrieveAMetricAlertRuleForAnOrganization({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        alert_rule_id: Number(alert_rule_id),
      },
    });
    const { data } = unwrapResult(result, "getMetricAlertRule");
    return JSON.stringify(data);
  },
});
