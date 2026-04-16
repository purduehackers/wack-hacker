import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

/** Get flamegraph profiling data for a transaction. */
export const get_flamegraph = tool({
  description:
    "Get flamegraph profiling data for a transaction. Shows CPU time distribution across function calls. Useful for identifying performance bottlenecks.",
  inputSchema: z.object({
    project_id: z.string().describe("Project ID"),
    transaction: z.string().describe("Transaction name (e.g. 'GET /api/users')"),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_id, transaction, stat_period }) => {
    const params = new URLSearchParams();
    params.set("project", project_id);
    params.set("query", `transaction:"${transaction}"`);
    params.set("statsPeriod", stat_period ?? "24h");
    const data = await sentryGet(`/organizations/${sentryOrg()}/profiling/flamegraph/?${params}`);
    return JSON.stringify(data);
  },
});

/** List slowest profiled functions. */
export const list_profiled_functions = tool({
  description:
    "List the slowest profiled functions. Shows function name, package, self-time, and total-time. Useful for finding CPU-heavy code.",
  inputSchema: z.object({
    project_id: z.string().describe("Project ID"),
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
  execute: async ({ project_id, transaction, sort, per_page, stat_period }) => {
    const params = new URLSearchParams();
    params.set("project", project_id);
    params.set("statsPeriod", stat_period ?? "24h");
    if (transaction) params.set("query", `transaction:"${transaction}"`);
    if (sort) params.set("sort", `-${sort}`);
    if (per_page) params.set("per_page", String(per_page));
    const data = await sentryGet(`/organizations/${sentryOrg()}/profiling/functions/?${params}`);
    return JSON.stringify(data);
  },
});
