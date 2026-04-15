import { tool } from "ai";
import { z } from "zod";

import { admin } from "../../skills/admin.ts";
import {
  projectPath,
  sentryDelete,
  sentryGet,
  sentryPaginated,
  sentryPost,
  sentryPut,
} from "./client.ts";

export const list_sentry_alert_rules = tool({
  description: `List alert rules for a project. Returns both issue alert rules and metric alert rules with their conditions and actions.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, cursor }) => {
    const { results, nextCursor } = await sentryPaginated<Record<string, unknown>>(
      projectPath(project_slug, "/rules/"),
      { cursor },
    );
    return JSON.stringify({
      rules: results.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conditions: r.conditions,
        actions: r.actions,
        filters: r.filters,
        actionMatch: r.actionMatch,
        filterMatch: r.filterMatch,
        frequency: r.frequency,
        dateCreated: r.dateCreated,
      })),
      nextCursor,
    });
  },
});

export const get_sentry_alert_rule = tool({
  description: `Get details of a specific alert rule including conditions, actions, filters, and frequency.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    rule_id: z.string().describe("Alert rule ID"),
  }),
  execute: async ({ project_slug, rule_id }) => {
    const rule = await sentryGet<Record<string, unknown>>(
      projectPath(project_slug, `/rules/${rule_id}/`),
    );
    return JSON.stringify(rule);
  },
});

export const create_sentry_alert_rule = tool({
  description: `Create a new issue alert rule for a project. Requires name, conditions (triggers), actions (notifications), and action match logic.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    name: z.string().describe("Alert rule name"),
    actionMatch: z
      .enum(["all", "any", "none"])
      .describe("How conditions are combined: all, any, or none must match"),
    conditions: z
      .array(z.record(z.string(), z.unknown()))
      .describe("Array of condition objects (e.g. first seen, regression, event frequency)"),
    actions: z
      .array(z.record(z.string(), z.unknown()))
      .describe("Array of action objects (e.g. send notification, create issue)"),
    filters: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Array of filter objects to narrow when rule fires"),
    filterMatch: z.enum(["all", "any", "none"]).optional().describe("How filters are combined"),
    frequency: z
      .number()
      .optional()
      .describe("Minimum time (minutes) between alerts from this rule"),
  }),
  execute: async ({ project_slug, ...body }) => {
    const rule = await sentryPost<Record<string, unknown>>(
      projectPath(project_slug, "/rules/"),
      body,
    );
    return JSON.stringify({
      id: rule.id,
      name: rule.name,
      status: rule.status,
      dateCreated: rule.dateCreated,
    });
  },
});

export const update_sentry_alert_rule = tool({
  description: `Update an existing alert rule — change name, conditions, actions, filters, or frequency.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    rule_id: z.string().describe("Alert rule ID"),
    name: z.string().optional().describe("New name"),
    actionMatch: z.enum(["all", "any", "none"]).optional(),
    conditions: z.array(z.record(z.string(), z.unknown())).optional(),
    actions: z.array(z.record(z.string(), z.unknown())).optional(),
    filters: z.array(z.record(z.string(), z.unknown())).optional(),
    filterMatch: z.enum(["all", "any", "none"]).optional(),
    frequency: z.number().optional(),
  }),
  execute: async ({ project_slug, rule_id, ...body }) => {
    const rule = await sentryPut<Record<string, unknown>>(
      projectPath(project_slug, `/rules/${rule_id}/`),
      body,
    );
    return JSON.stringify({
      id: rule.id,
      name: rule.name,
      status: rule.status,
    });
  },
});

export const delete_sentry_alert_rule = admin(
  tool({
    description: `Delete an alert rule. This cannot be undone.`,
    inputSchema: z.object({
      project_slug: z.string().describe("Project slug"),
      rule_id: z.string().describe("Alert rule ID to delete"),
    }),
    execute: async ({ project_slug, rule_id }) => {
      await sentryDelete(projectPath(project_slug, `/rules/${rule_id}/`));
      return JSON.stringify({ deleted: true, rule_id });
    },
  }),
);
