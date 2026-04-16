import { tool } from "ai";
import { z } from "zod";

import { sentryOrg, sentryGet, sentryMutate } from "./client.ts";

interface SentryAlertRule {
  id: string;
  name: string;
  dateCreated: string;
  conditions: unknown[];
  actions: unknown[];
  actionMatch: string;
  frequency: number;
  environment: string | null;
  status: string;
}

interface SentryMetricAlertRule {
  id: string;
  name: string;
  dateCreated: string;
  aggregate: string;
  query: string;
  timeWindow: number;
  resolveThreshold: number | null;
  thresholdType: number;
  triggers: unknown[];
  projects: string[];
  environment: string | null;
  status: number;
}

/** List issue alert rules for a project. */
export const list_alert_rules = tool({
  description: "List issue alert rules for a Sentry project.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const data = await sentryGet<SentryAlertRule[]>(
      `/projects/${sentryOrg()}/${project_slug}/rules/`,
    );
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
export const get_alert_rule = tool({
  description: "Get full details for a Sentry issue alert rule, including conditions and actions.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    rule_id: z.string().describe("Alert rule ID"),
  }),
  execute: async ({ project_slug, rule_id }) => {
    const data = await sentryGet<SentryAlertRule>(
      `/projects/${sentryOrg()}/${project_slug}/rules/${rule_id}/`,
    );
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
    const data = await sentryMutate(`/projects/${sentryOrg()}/${project_slug}/rules/`, "POST", {
      name,
      conditions,
      actions,
      actionMatch: action_match ?? "all",
      frequency: frequency ?? 30,
      environment,
    });
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
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.conditions !== undefined) body.conditions = input.conditions;
    if (input.actions !== undefined) body.actions = input.actions;
    if (input.action_match !== undefined) body.actionMatch = input.action_match;
    if (input.frequency !== undefined) body.frequency = input.frequency;
    if (input.environment !== undefined) body.environment = input.environment;
    const data = await sentryMutate(
      `/projects/${sentryOrg()}/${project_slug}/rules/${rule_id}/`,
      "PUT",
      body,
    );
    return JSON.stringify(data);
  },
});

/** Delete an issue alert rule. */
export const delete_alert_rule = tool({
  description: "Permanently delete a Sentry issue alert rule. This action cannot be undone.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    rule_id: z.string().describe("Alert rule ID"),
  }),
  execute: async ({ project_slug, rule_id }) => {
    await sentryMutate(`/projects/${sentryOrg()}/${project_slug}/rules/${rule_id}/`, "DELETE");
    return JSON.stringify({ deleted: true });
  },
});

/** List metric alert rules for the organization. */
export const list_metric_alert_rules = tool({
  description:
    "List metric alert rules for the Sentry organization. Metric alerts trigger on aggregate data like error count or latency.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
  }),
  execute: async ({ project_slug }) => {
    const params = new URLSearchParams();
    if (project_slug) params.set("project", project_slug);
    const data = await sentryGet<SentryMetricAlertRule[]>(
      `/organizations/${sentryOrg()}/alert-rules/?${params}`,
    );
    return JSON.stringify(
      data.map((r) => ({
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
    const data = await sentryGet<SentryMetricAlertRule>(
      `/organizations/${sentryOrg()}/alert-rules/${alert_rule_id}/`,
    );
    return JSON.stringify(data);
  },
});
