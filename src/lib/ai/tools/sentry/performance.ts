import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

/** List transactions with performance metrics using the Discover API. */
export const list_transactions = tool({
  description:
    "List transaction events with performance metrics. Common fields: 'transaction', 'count()', 'p50(transaction.duration)', 'p95(transaction.duration)', 'avg(transaction.duration)'.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    fields: z
      .array(z.string())
      .describe("Fields to query (e.g. ['transaction', 'count()', 'p95(transaction.duration)'])"),
    query: z.string().optional().describe("Filter query (e.g. 'transaction.op:http.server')"),
    sort: z.string().optional().describe("Sort field with optional '-' prefix for descending"),
    per_page: z.number().max(100).optional(),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d', '14d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const params = new URLSearchParams();
    params.set("dataset", "discover");
    params.set("project", project_slug);
    params.set("statsPeriod", stat_period ?? "24h");
    for (const f of fields) params.append("field", f);
    if (query) params.set("query", query);
    if (sort) params.set("sort", sort);
    if (per_page) params.set("per_page", String(per_page));
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/?${params}`);
    return JSON.stringify(data);
  },
});

/** Get aggregated performance stats for a transaction over time. */
export const get_transaction_summary = tool({
  description:
    "Get time-series performance data for a specific transaction. Useful for spotting regressions or trends.",
  inputSchema: z.object({
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
    const params = new URLSearchParams();
    params.set("project", project_slug);
    params.set("query", `transaction:"${transaction}"`);
    params.set("yAxis", y_axis ?? "p95(transaction.duration)");
    params.set("statsPeriod", stat_period ?? "24h");
    const data = await sentryGet(`/organizations/${sentryOrg()}/events-stats/?${params}`);
    return JSON.stringify(data);
  },
});

/** Query span-level performance data. */
export const list_spans = tool({
  description:
    "Query span-level data for deeper performance analysis. Useful for finding slow database queries, HTTP calls, or specific operations.",
  inputSchema: z.object({
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
    per_page: z.number().max(100).optional(),
    stat_period: z.string().optional().describe("Time range (e.g. '24h', '7d')"),
  }),
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const params = new URLSearchParams();
    params.set("dataset", "spansIndexed");
    params.set("project", project_slug);
    params.set("statsPeriod", stat_period ?? "24h");
    const defaultFields = ["span.op", "span.description", "avg(span.duration)", "count()"];
    for (const f of fields ?? defaultFields) params.append("field", f);
    if (query) params.set("query", query);
    if (sort) params.set("sort", sort);
    if (per_page) params.set("per_page", String(per_page));
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/?${params}`);
    return JSON.stringify(data);
  },
});
