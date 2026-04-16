import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

/** List available custom metrics. */
export const list_metrics = tool({
  description:
    "List available custom metrics (counters, distributions, gauges, sets) in the Sentry organization.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
  }),
  execute: async ({ project_slug }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/meta/`, {
      project: project_slug,
    });
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
    project_slug: z.string().optional().describe("Filter by project slug"),
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
  execute: async ({ mri, op, project_slug, stat_period, interval, group_by, query }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/data/`, {
      field: `${op}(${mri})`,
      statsPeriod: stat_period ?? "24h",
      interval: interval ?? "1h",
      project: project_slug,
      groupBy: group_by,
      query,
    });
    return JSON.stringify(data);
  },
});

/** List tag keys available for metrics. */
export const list_metric_tags = tool({
  description: "List tag keys available for custom metrics filtering and grouping.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    metric: z.string().optional().describe("Filter by metric MRI"),
  }),
  execute: async ({ project_slug, metric }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/tags/`, {
      project: project_slug,
      metric,
    });
    return JSON.stringify(data);
  },
});

/** List values for a specific metric tag key. */
export const get_metric_tag_values = tool({
  description: "Get values for a specific metric tag key.",
  inputSchema: z.object({
    tag_key: z.string().describe("Tag key to list values for"),
    project_slug: z.string().optional().describe("Filter by project slug"),
    metric: z.string().optional().describe("Filter by metric MRI"),
  }),
  execute: async ({ tag_key, project_slug, metric }) => {
    const data = await sentryGet(
      `/organizations/${sentryOrg()}/metrics/tags/${encodeURIComponent(tag_key)}/`,
      { project: project_slug, metric },
    );
    return JSON.stringify(data);
  },
});
