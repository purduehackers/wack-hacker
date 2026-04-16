import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

/** List available custom metrics. */
export const list_metrics = tool({
  description:
    "List available custom metrics (counters, distributions, gauges, sets) in the Sentry organization.",
  inputSchema: z.object({
    project_id: z.string().optional().describe("Filter by project ID"),
  }),
  execute: async ({ project_id }) => {
    const params = new URLSearchParams();
    if (project_id) params.set("project", project_id);
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/meta/?${params}`);
    return JSON.stringify(data);
  },
});

/** Query custom metrics data. */
export const query_metrics = tool({
  description:
    "Query custom metrics data with aggregation. Supports counters, distributions, gauges, and sets.",
  inputSchema: z.object({
    mri: z
      .string()
      .describe(
        "Metric Resource Identifier (e.g. 'c:custom/my_counter@none', 'd:custom/my_distribution@millisecond')",
      ),
    op: z
      .enum(["sum", "count", "avg", "min", "max", "p50", "p75", "p90", "p95", "p99"])
      .describe("Aggregation operation"),
    project_id: z.string().optional().describe("Filter by project ID"),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
    interval: z
      .string()
      .optional()
      .describe("Time bucket interval (e.g. '1h', '1d'). Defaults to '1h'."),
    group_by: z.string().optional().describe("Tag key to group results by"),
    query: z.string().optional().describe("Tag filter query (e.g. 'environment:production')"),
  }),
  execute: async ({ mri, op, project_id, stat_period, interval, group_by, query }) => {
    const params = new URLSearchParams();
    params.set("field", `${op}(${mri})`);
    params.set("statsPeriod", stat_period ?? "24h");
    params.set("interval", interval ?? "1h");
    if (project_id) params.set("project", project_id);
    if (group_by) params.set("groupBy", group_by);
    if (query) params.set("query", query);
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/data/?${params}`);
    return JSON.stringify(data);
  },
});

/** List tag keys available for metrics. */
export const list_metric_tags = tool({
  description: "List tag keys available for custom metrics filtering and grouping.",
  inputSchema: z.object({
    project_id: z.string().optional().describe("Filter by project ID"),
    metric: z.string().optional().describe("Filter by metric MRI"),
  }),
  execute: async ({ project_id, metric }) => {
    const params = new URLSearchParams();
    if (project_id) params.set("project", project_id);
    if (metric) params.set("metric", metric);
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/tags/?${params}`);
    return JSON.stringify(data);
  },
});

/** List values for a specific metric tag key. */
export const get_metric_tag_values = tool({
  description: "Get values for a specific metric tag key.",
  inputSchema: z.object({
    tag_key: z.string().describe("Tag key to list values for"),
    project_id: z.string().optional().describe("Filter by project ID"),
    metric: z.string().optional().describe("Filter by metric MRI"),
  }),
  execute: async ({ tag_key, project_id, metric }) => {
    const params = new URLSearchParams();
    if (project_id) params.set("project", project_id);
    if (metric) params.set("metric", metric);
    const data = await sentryGet(
      `/organizations/${sentryOrg()}/metrics/tags/${encodeURIComponent(tag_key)}/?${params}`,
    );
    return JSON.stringify(data);
  },
});
