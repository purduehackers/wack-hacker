import {
  deprecatedListAProject_sIssueAlertRules,
  deprecatedRetrieveAnIssueAlertRuleForAProject,
  deprecatedCreateAnIssueAlertRuleForAProject,
  deprecatedUpdateAnIssueAlertRule,
  deprecatedDeleteAnIssueAlertRule,
  deprecatedListAnOrganization_sMetricAlertRules,
  deprecatedRetrieveAMetricAlertRuleForAnOrganization,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

const metricAlertProjectionSchema = z.looseObject({ status: z.string().nullish() });
const issueAlertActionMatchSchema = z.enum(["all", "any", "none"]);

/** List issue alert rules for a project. */
export const list_alert_rules = defineTool({
  description: "List issue alert rules for a Sentry project.",
  access: { risk: "read" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await deprecatedListAProject_sIssueAlertRules({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "listAlertRules");
    return JSON.stringify(
      data.map((r) => ({
        id: r.id,
        name: r.name,
        dateCreated: r.dateCreated,
        actionMatch: r.actionMatch,
        frequency: r.frequency,
        environment: r.environment,
        status: r.status,
        conditionCount: r.conditions.length,
        actionCount: r.actions.length,
      })),
    );
  },
});

/** Get full details for an issue alert rule. */
export const get_alert_rule = defineTool({
  description: "Get full details for a Sentry issue alert rule, including conditions and actions.",
  access: { risk: "read" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
    rule_id: z.string().describe("Alert rule ID"),
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

/** Create a new issue alert rule. */
export const create_alert_rule = defineTool({
  description:
    "Create a new Sentry issue alert rule. Requires project slug, name, conditions, actions, and frequency.",
  access: { risk: "write" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
    name: z.string().describe("Alert rule name"),
    conditions: z
      .array(z.record(z.string(), z.unknown()))
      .describe("Array of condition objects (e.g. new issue, event frequency)"),
    actions: z
      .array(z.record(z.string(), z.unknown()))
      .describe("Array of action objects (e.g. send notification)"),
    action_match: z
      .enum(["all", "any", "none"])
      .optional()
      .describe("How conditions are combined (default: 'all')"),
    frequency: z.number().optional().describe("Minimum minutes between alerts (default: 30)"),
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
        ...(environment === undefined ? {} : { environment }),
      },
    });
    const { data } = unwrapResult(result, "createAlertRule");
    return JSON.stringify(data);
  },
});

/** Update an existing issue alert rule. */
export const update_alert_rule = defineTool({
  description: "Update an existing Sentry issue alert rule.",
  access: { risk: "write" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
    rule_id: z.string().describe("Alert rule ID"),
    name: z.string().optional(),
    conditions: z.array(z.record(z.string(), z.unknown())).optional(),
    actions: z.array(z.record(z.string(), z.unknown())).optional(),
    action_match: z.enum(["all", "any", "none"]).optional(),
    frequency: z.number().optional(),
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

/** Delete an issue alert rule. */
export const delete_alert_rule = defineTool({
  description: "Permanently delete a Sentry issue alert rule. This action cannot be undone.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
    rule_id: z.string().describe("Alert rule ID"),
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

/** List metric alert rules for the organization. */
export const list_metric_alert_rules = defineTool({
  description:
    "List metric alert rules for the Sentry organization. Metric alerts trigger on aggregate data like error count or latency.",
  access: { risk: "read" },
  input: z.object({}),
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

/** Get full details for a metric alert rule. */
export const get_metric_alert_rule = defineTool({
  description:
    "Get full details for a Sentry metric alert rule, including triggers and thresholds.",
  access: { risk: "read" },
  input: z.object({
    alert_rule_id: z.string().describe("Metric alert rule ID"),
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
