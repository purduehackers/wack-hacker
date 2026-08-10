import {
  deprecatedRetrieveAnIssueAlertRuleForAProject,
  deprecatedUpdateAnIssueAlertRule,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

const issueAlertActionMatchSchema = z.enum(["all", "any", "none"]);

export const update_alert_rule = defineTool({
  description: "Update an existing Sentry issue alert rule.",
  access: { risk: "write" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    rule_id: sentryNumericId.describe("Alert rule ID"),
    name: z.string().optional(),
    conditions: z.array(z.record(z.string(), z.json())).optional(),
    actions: z.array(z.record(z.string(), z.json())).optional(),
    action_match: z.enum(["all", "any", "none"]).optional(),
    frequency: z.int().min(1).optional(),
    environment: z.string().optional(),
  }),
  execute: async ({ project_slug, rule_id, ...input }) => {
    // The SDK requires all body fields; we fetch first then merge
    const getResult = await deprecatedRetrieveAnIssueAlertRuleForAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        rule_id: Number(rule_id),
      },
    });
    const { data: existing } = unwrapResult(getResult, "getAlertRuleForUpdate");
    const e = existing;
    const actionMatch = issueAlertActionMatchSchema.parse(input.action_match ?? e.actionMatch);
    const environment = input.environment ?? e.environment ?? undefined;

    const result = await deprecatedUpdateAnIssueAlertRule({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        rule_id: Number(rule_id),
      },
      body: {
        name: input.name ?? e.name,
        conditions: input.conditions ?? e.conditions,
        actions: input.actions ?? e.actions,
        actionMatch,
        frequency: input.frequency ?? e.frequency,
        ...(environment === undefined ? {} : { environment }),
      },
    });
    const { data } = unwrapResult(result, "updateAlertRule");
    return JSON.stringify(data);
  },
});
