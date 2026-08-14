import { deprecatedCreateAnIssueAlertRuleForAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const create_alert_rule = defineTool({
  description:
    "Create a new Sentry issue alert rule. Requires project slug, name, conditions, actions, and frequency.",
  access: { risk: "write" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    name: z.string().describe("Alert rule name"),
    conditions: z
      .array(z.record(z.string(), z.json()))
      .describe("Array of condition objects (e.g. new issue, event frequency)"),
    actions: z
      .array(z.record(z.string(), z.json()))
      .describe("Array of action objects (e.g. send notification)"),
    action_match: z
      .enum(["all", "any", "none"])
      .optional()
      .describe("How conditions are combined (default: 'all')"),
    frequency: z.int().min(1).optional().describe("Minimum minutes between alerts (default: 30)"),
    environment: z.string().optional().describe("Environment filter"),
  }),
  execute: async ({
    project_slug,
    name,
    conditions,
    actions,
    action_match,
    frequency,
    environment,
  }) => {
    const result = await deprecatedCreateAnIssueAlertRuleForAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      body: {
        name,
        conditions,
        actions,
        actionMatch: action_match ?? "all",
        frequency: frequency ?? 30,
        ...(environment !== undefined && { environment }),
      },
    });
    const { data } = unwrapResult(result, "createAlertRule");
    return JSON.stringify(data);
  },
});
