import { deprecatedListAnOrganization_sMetricAlertRules, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

// Read-only projection over a field the generated SDK type omits: an unexpected
// shape must degrade to "absent" rather than fail the tool.
const metricAlertProjectionSchema = z.looseObject({
  status: z.string().nullish().catch(undefined),
});

export const list_metric_alert_rules = defineTool({
  description:
    "List metric alert rules for the Sentry organization. Metric alerts trigger on aggregate data like error count or latency.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await deprecatedListAnOrganization_sMetricAlertRules({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
    });
    const { data } = unwrapResult(result, "listMetricAlertRules");
    return JSON.stringify(
      data.map((rule) => ({
        id: rule.id,
        name: rule.name,
        dateCreated: rule.dateCreated,
        aggregate: rule.aggregate,
        query: rule.query,
        timeWindow: rule.timeWindow,
        status: metricAlertProjectionSchema.parse(rule).status,
        projects: rule.projects,
        environment: rule.environment,
      })),
    );
  },
});
