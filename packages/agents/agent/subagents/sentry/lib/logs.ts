import {
  queryExploreEventsInTableFormat,
  queryExploreEventsInTimeseriesFormat,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg, sentryProjectId } from "./client.ts";
import { perPageField } from "./constants.ts";

/** Search structured logs. */
export const search_logs = defineTool({
  description:
    "Search structured log entries across Sentry projects. Supports filtering by log level, message content, and tags.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Search query (e.g. 'level:error', 'message:*timeout*')"),
    fields: z
      .array(z.string())
      .optional()
      .describe("Fields to return (e.g. ['message', 'level', 'timestamp', 'trace_id'])"),
    sort: z.string().optional().describe("Sort field (e.g. '-timestamp')"),
    per_page: perPageField,
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '1h', '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const projectId = await sentryProjectId(project_slug);
    const defaultFields = ["message", "severity_text", "timestamp", "trace_id"];
    const result = await queryExploreEventsInTableFormat({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        dataset: "logs",
        field: fields ?? defaultFields,
        ...(project_slug === undefined ? {} : { project: [projectId] }),
        statsPeriod: stat_period ?? "24h",
        ...(query === undefined ? {} : { query }),
        sort: sort ?? "-timestamp",
        ...(per_page === undefined ? {} : { per_page }),
      },
    });
    const { data } = unwrapResult(result, "searchLogs");
    return JSON.stringify(data);
  },
});

/** Get log volume stats over time. */
export const get_log_stats = defineTool({
  description:
    "Get log volume over time, optionally grouped by severity level. Useful for spotting log spikes.",
  access: { risk: "read" },
  input: z.strictObject({
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
    const projectId = await sentryProjectId(project_slug);
    const result = await queryExploreEventsInTimeseriesFormat({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        dataset: "logs",
        ...(project_slug === undefined ? {} : { project: [projectId] }),
        statsPeriod: stat_period ?? "24h",
        yAxis: y_axis ?? "count()",
        ...(query === undefined ? {} : { query }),
      },
    });
    const { data } = unwrapResult(result, "getLogStats");
    return JSON.stringify(data);
  },
});
