import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg } from "../../client.ts";

export const query_metrics = defineTool({
  description:
    "Query custom metrics data with aggregation. Supports counters, distributions, gauges, and sets.",
  access: { risk: "read" },
  input: z.strictObject({
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
