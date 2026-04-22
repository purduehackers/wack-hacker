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
import { tool } from "ai";
import { z } from "zod";

import { admin } from "../../skills/index.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

/** List issue alert rules for a project. */
export const list_alert_rules = tool({
  description: "List issue alert rules for a Sentry project.",
  inputSchema: z.object({
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
      (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id,
        name: r.name,
        dateCreated: r.dateCreated,
        actionMatch: r.actionMatch,
        frequency: r.frequency,
        environment: r.environment,
        status: r.status,
        conditionCount: (r.conditions as unknown[])?.length ?? 0,
        actionCount: (r.actions as unknown[])?.length ?? 0,
      })),
    );
  },
});

/** Get full details for an issue alert rule. */
export const get_alert_rule = tool({
  description: "Get full details for a Sentry issue alert rule, including conditions and actions.",
  inputSchema: z.object({
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
export const create_alert_rule = tool({
  description:
    "Create a new Sentry issue alert rule. Requires project slug, name, conditions, actions, and frequency.",
  inputSchema: z.object({
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
        environment,
      },
    });
    const { data } = unwrapResult(result, "createAlertRule");
    return JSON.stringify(data);
  },
});

/** Update an existing issue alert rule. */
export const update_alert_rule = tool({
  description: "Update an existing Sentry issue alert rule.",
  inputSchema: z.object({
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
    const e = existing as Record<string, unknown>;

    const result = await deprecatedUpdateAnIssueAlertRule({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        rule_id: Number(rule_id),
      },
      body: {
        name: input.name ?? (e.name as string),
        conditions: (input.conditions ?? e.conditions) as Array<Record<string, unknown>>,
        actions: (input.actions ?? e.actions) as Array<Record<string, unknown>>,
        actionMatch: (input.action_match ?? e.actionMatch) as "all" | "any" | "none",
        frequency: (input.frequency ?? e.frequency) as number,
        environment:
          input.environment !== undefined
            ? input.environment
            : (e.environment as string | undefined),
      },
    });
    const { data } = unwrapResult(result, "updateAlertRule");
    return JSON.stringify(data);
  },
});

/** Delete an issue alert rule. */
// destructive
export const delete_alert_rule = admin(
  tool({
    description: "Permanently delete a Sentry issue alert rule. This action cannot be undone.",
    inputSchema: z.object({
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
  }),
);

/** List metric alert rules for the organization. */
export const list_metric_alert_rules = tool({
  description:
    "List metric alert rules for the Sentry organization. Metric alerts trigger on aggregate data like error count or latency.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await deprecatedListAnOrganization_sMetricAlertRules({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
    });
    const { data } = unwrapResult(result, "listMetricAlertRules");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id,
        name: r.name,
        dateCreated: r.dateCreated,
        aggregate: r.aggregate,
        query: r.query,
        timeWindow: r.timeWindow,
        status: r.status,
        projects: r.projects,
        environment: r.environment,
      })),
    );
  },
});

/** Get full details for a metric alert rule. */
export const get_metric_alert_rule = tool({
  description:
    "Get full details for a Sentry metric alert rule, including triggers and thresholds.",
  inputSchema: z.object({
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
