import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

/** Search structured logs. */
export const search_logs = tool({
  description:
    "Search structured log entries across Sentry projects. Supports filtering by log level, message content, and tags.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Search query (e.g. 'level:error', 'message:*timeout*')"),
    fields: z
      .array(z.string())
      .optional()
      .describe("Fields to return (e.g. ['message', 'level', 'timestamp', 'trace_id'])"),
    sort: z.string().optional().describe("Sort field (e.g. '-timestamp')"),
    per_page: z.number().max(100).optional(),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '1h', '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, query, fields, sort, per_page, stat_period }) => {
    const params = new URLSearchParams();
    params.set("dataset", "ourlogs");
    params.set("project", project_slug);
    params.set("statsPeriod", stat_period ?? "24h");
    const defaultFields = ["message", "severity_text", "timestamp", "trace_id"];
    for (const f of fields ?? defaultFields) params.append("field", f);
    if (query) params.set("query", query);
    if (sort) params.set("sort", sort);
    else params.set("sort", "-timestamp");
    if (per_page) params.set("per_page", String(per_page));
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/?${params}`);
    return JSON.stringify(data);
  },
});

/** Get log volume stats over time. */
export const get_log_stats = tool({
  description:
    "Get log volume over time, optionally grouped by severity level. Useful for spotting log spikes.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Filter query"),
    y_axis: z
      .string()
      .optional()
      .describe("Metric to plot (e.g. 'count()'). Defaults to 'count()'."),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, query, y_axis, stat_period }) => {
    const params = new URLSearchParams();
    params.set("dataset", "ourlogs");
    params.set("project", project_slug);
    params.set("yAxis", y_axis ?? "count()");
    params.set("statsPeriod", stat_period ?? "24h");
    if (query) params.set("query", query);
    const data = await sentryGet(`/organizations/${sentryOrg()}/events-stats/?${params}`);
    return JSON.stringify(data);
  },
});
