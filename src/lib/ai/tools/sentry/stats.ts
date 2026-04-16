import {
  retrieveEventCountsForAnOrganizationV2,
  retrieveEventCountsForAProject,
  unwrapResult,
} from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { sentryOpts, sentryOrg } from "./client.ts";

/** Get organization usage stats over time. */
export const get_org_stats = tool({
  description:
    "Get organization-level usage statistics — events received, dropped, filtered, and more. Useful for understanding Sentry quota usage and event volume.",
  inputSchema: z.object({
    group: z
      .enum(["outcome", "category", "reason", "project"])
      .optional()
      .describe("Group results by this dimension. Defaults to 'outcome'."),
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
  execute: async ({ group, field, stat_period, interval, project_slug }) => {
    const result = await retrieveEventCountsForAnOrganizationV2({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        groupBy: group ? [group] : ["outcome"],
        field: (field ?? "sum(quantity)") as "sum(quantity)" | "sum(times_seen)",
        statsPeriod: stat_period ?? "24h",
        interval,
        project: project_slug ? [project_slug] : undefined,
      },
    });
    const { data } = unwrapResult(result, "getOrgStats");
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
      .enum(["received", "rejected", "blacklisted"])
      .optional()
      .describe("Stat category. Defaults to 'received'."),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, stat, stat_period }) => {
    const period = stat_period ?? "24h";
    const hours = period.endsWith("d")
      ? Number(period.slice(0, -1)) * 24
      : Number(period.slice(0, -1));
    const since = String(Math.floor(Date.now() / 1000) - hours * 3600);
    const result = await retrieveEventCountsForAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      query: {
        stat: (stat ?? "received") as "received" | "rejected" | "blacklisted",
        since,
      },
    });
    const { data } = unwrapResult(result, "getProjectStats");
    return JSON.stringify(data);
  },
});
