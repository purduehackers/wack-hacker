import {
  queryExploreEventsInTableFormat,
  queryExploreEventsInTimeseriesFormat,
  unwrapResult,
} from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { sentryOpts, sentryOrg } from "./client.ts";

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
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const defaultFields = ["message", "severity_text", "timestamp", "trace_id"];
    const result = await queryExploreEventsInTableFormat({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        dataset: "logs",
        field: fields ?? defaultFields,
        project: project_slug ? ([project_slug] as unknown as number[]) : undefined,
        statsPeriod: stat_period ?? "24h",
        query,
        sort: sort ?? "-timestamp",
        per_page,
      },
    });
    const { data } = unwrapResult(result, "searchLogs");
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
    const result = await queryExploreEventsInTimeseriesFormat({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        dataset: "logs",
        project: project_slug ? ([project_slug] as unknown as number[]) : undefined,
        statsPeriod: stat_period ?? "24h",
        yAxis: y_axis ?? "count()",
        query,
      },
    });
    const { data } = unwrapResult(result, "getLogStats");
    return JSON.stringify(data);
  },
});
