import { queryExploreEventsInTableFormat, unwrapResult } from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { escapeQuery, sentryGet, sentryOpts, sentryOrg } from "./client.ts";

/** Get flamegraph profiling data for a transaction. */
export const get_flamegraph = tool({
  description:
    "Get flamegraph profiling data for a transaction. Shows CPU time distribution across function calls. Useful for identifying performance bottlenecks.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    transaction: z.string().describe("Transaction name (e.g. 'GET /api/users')"),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, transaction, stat_period }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/profiling/flamegraph/`, {
      project: project_slug,
      query: `transaction:"${escapeQuery(transaction)}"`,
      statsPeriod: stat_period ?? "24h",
    });
    return JSON.stringify(data);
  },
});

/** List slowest profiled functions. */
export const list_profiled_functions = tool({
  description:
    "List the slowest profiled functions. Shows function name, package, self-time, and total-time. Useful for finding CPU-heavy code.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    transaction: z.string().optional().describe("Filter by transaction name"),
    sort: z
      .enum(["p75()", "p95()", "p99()", "count()", "avg()"])
      .optional()
      .describe("Sort by aggregation. Defaults to 'p75()'."),
    per_page: z.number().max(100).optional(),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ transaction, sort, per_page, stat_period }) => {
    const defaultFields = ["function", "package", "p75()", "p95()", "count()", "sum()"];
    const result = await queryExploreEventsInTableFormat({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        dataset: "profile_functions",
        field: defaultFields,
        statsPeriod: stat_period ?? "24h",
        query: transaction ? `transaction:"${escapeQuery(transaction)}"` : undefined,
        sort: sort ? `-${sort}` : "-p75()",
        per_page,
      },
    });
    const { data } = unwrapResult(result, "listProfiledFunctions");
    return JSON.stringify(data);
  },
});
