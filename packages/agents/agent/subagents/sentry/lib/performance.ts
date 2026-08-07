import { queryExploreEventsInTableFormat, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { escapeQuery, sentryGet, sentryOpts, sentryOrg, sentryProjectId } from "./client.ts";
import { perPageField } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

/** List transactions with performance metrics using the Discover API. */
export const list_transactions = defineTool({
  name: "list_transactions",
  domain: "sentry",
  description:
    "List transaction events with performance metrics. Common fields: 'transaction', 'count()', 'p50(transaction.duration)', 'p95(transaction.duration)', 'avg(transaction.duration)'.",
  access: { risk: "read" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
    fields: z
      .array(z.string())
      .describe("Fields to query (e.g. ['transaction', 'count()', 'p95(transaction.duration)'])"),
    query: z.string().optional().describe("Filter query (e.g. 'transaction.op:http.server')"),
    sort: z.string().optional().describe("Sort field with optional '-' prefix for descending"),
    per_page: perPageField,
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d', '14d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/`, {
      dataset: "discover",
      project: project_slug,
      statsPeriod: stat_period ?? "24h",
      field: fields,
      query,
      sort,
      per_page,
    });
    return JSON.stringify(data);
  },
});

/** Get aggregated performance stats for a transaction over time. */
export const get_transaction_summary = defineTool({
  name: "get_transaction_summary",
  domain: "sentry",
  description:
    "Get time-series performance data for a specific transaction. Useful for spotting regressions or trends.",
  access: { risk: "read" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
    transaction: z.string().describe("Transaction name (e.g. 'GET /api/users')"),
    y_axis: z
      .string()
      .optional()
      .describe(
        "Metric to plot (e.g. 'p95(transaction.duration)', 'count()'). Defaults to 'p95(transaction.duration)'.",
      ),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, transaction, y_axis, stat_period }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/events-stats/`, {
      project: project_slug,
      query: `transaction:"${escapeQuery(transaction)}"`,
      yAxis: y_axis ?? "p95(transaction.duration)",
      statsPeriod: stat_period ?? "24h",
    });
    return JSON.stringify(data);
  },
});

/** Query span-level performance data. */
export const list_spans = defineTool({
  name: "list_spans",
  domain: "sentry",
  description:
    "Query span-level data for deeper performance analysis. Useful for finding slow database queries, HTTP calls, or specific operations.",
  access: { risk: "read" },
  input: z.object({
    project_slug: z.string().describe("Project slug"),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Fields to query (e.g. ['span.op', 'span.description', 'avg(span.duration)', 'count()'])",
      ),
    query: z
      .string()
      .optional()
      .describe("Filter query (e.g. 'span.op:db span.description:*users*')"),
    sort: z.string().optional().describe("Sort field"),
    per_page: perPageField,
    stat_period: z.string().optional().describe("Time range (e.g. '24h', '7d')"),
  }),
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const projectId = await sentryProjectId(project_slug);
    const defaultFields = ["span.op", "span.description", "avg(span.duration)", "count()"];
    const result = await queryExploreEventsInTableFormat({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        dataset: "spans",
        field: fields ?? defaultFields,
        ...(project_slug === undefined ? {} : { project: [projectId] }),
        statsPeriod: stat_period ?? "24h",
        ...(query === undefined ? {} : { query }),
        ...(sort === undefined ? {} : { sort }),
        ...(per_page === undefined ? {} : { per_page }),
      },
    });
    const { data } = unwrapResult(result, "listSpans");
    return JSON.stringify(data);
  },
});
