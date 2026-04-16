import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

/** Get organization usage stats over time. */
export const get_org_stats = tool({
  description:
    "Get organization-level usage statistics — events received, dropped, filtered, and more. Useful for understanding Sentry quota usage and event volume.",
  inputSchema: z.object({
    stat: z
      .enum(["received", "rejected", "blacklisted", "filtered"])
      .optional()
      .describe("Stat category to query. Defaults to 'received'."),
    group: z
      .enum(["outcome", "category", "reason", "project"])
      .optional()
      .describe("Group results by this dimension"),
    field: z
      .enum(["sum(quantity)", "sum(times_seen)"])
      .optional()
      .describe("Aggregation field. Defaults to 'sum(quantity)'."),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d', '30d'). Defaults to '24h'."),
    interval: z
      .string()
      .optional()
      .describe("Time bucket interval (e.g. '1h', '1d'). Defaults to '1h'."),
    project_slug: z.string().optional().describe("Filter to a specific project slug"),
  }),
  execute: async ({ stat, group, field, stat_period, interval, project_slug }) => {
    const params = new URLSearchParams();
    if (stat) params.set("stat", stat);
    if (group) params.set("groupBy", group);
    params.set("field", field ?? "sum(quantity)");
    params.set("statsPeriod", stat_period ?? "24h");
    params.set("interval", interval ?? "1h");
    if (project_slug) params.set("project", project_slug);
    const data = await sentryGet(`/organizations/${sentryOrg()}/stats_v2/?${params}`);
    return JSON.stringify(data);
  },
});

/** Get project-level event stats. */
export const get_project_stats = tool({
  description:
    "Get event statistics for a specific Sentry project — volume over time broken down by outcome.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    stat: z
      .enum(["received", "rejected", "blacklisted", "filtered"])
      .optional()
      .describe("Stat category. Defaults to 'received'."),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, stat, stat_period }) => {
    const params = new URLSearchParams();
    if (stat) params.set("stat", stat);
    params.set("statsPeriod", stat_period ?? "24h");
    const data = await sentryGet(`/projects/${sentryOrg()}/${project_slug}/stats/?${params}`);
    return JSON.stringify(data);
  },
});
