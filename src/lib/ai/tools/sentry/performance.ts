import { tool } from "ai";
import { z } from "zod";

import { orgPath, sentryGet, sentryPaginated } from "./client.ts";

export const list_sentry_transactions = tool({
  description: `List transaction names for a project with aggregate performance stats (p50, p95, throughput, failure rate). Useful for finding slow or error-prone endpoints.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Filter transactions by name substring"),
    sort: z.enum(["p50", "p95", "count", "failure_rate"]).optional().describe("Sort field"),
    per_page: z.number().max(50).optional().describe("Results per page (max 50)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, query, sort, per_page, cursor }) => {
    const field = [
      "transaction",
      "p50(transaction.duration)",
      "p95(transaction.duration)",
      "count()",
      "failure_rate()",
    ];
    const params: Record<string, string | number | undefined> = {
      project: project_slug,
      field: field.join(","),
      query: query ? `transaction:*${query}*` : undefined,
      sort: sort ? mapSortField(sort) : undefined,
      per_page: per_page ?? 20,
      cursor,
    };
    const { results, nextCursor } = await sentryPaginated<Record<string, unknown>>(
      orgPath("/events/"),
      params,
    );
    return JSON.stringify({
      transactions: results.map((r) => ({
        transaction: r.transaction,
        p50: r["p50(transaction.duration)"],
        p95: r["p95(transaction.duration)"],
        count: r["count()"],
        failureRate: r["failure_rate()"],
      })),
      nextCursor,
    });
  },
});

export const get_sentry_transaction_summary = tool({
  description: `Get performance summary for a specific transaction — p50, p75, p95, p99 latency, throughput, failure rate, and status breakdown.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    transaction: z.string().describe("Transaction name (e.g. 'GET /api/users')"),
    period: z
      .enum(["1h", "24h", "7d", "14d", "30d"])
      .optional()
      .describe("Time period (default 24h)"),
  }),
  execute: async ({ project_slug, transaction, period }) => {
    const field = [
      "p50(transaction.duration)",
      "p75(transaction.duration)",
      "p95(transaction.duration)",
      "p99(transaction.duration)",
      "count()",
      "failure_rate()",
      "apdex()",
    ];
    const result = await sentryGet<Record<string, unknown>>(orgPath("/events/"), {
      project: project_slug,
      field: field.join(","),
      query: `transaction:${transaction}`,
      statsPeriod: period ?? "24h",
      per_page: "1",
    });
    const data = Array.isArray(result) ? result[0] : result;
    if (!data) {
      return JSON.stringify({ error: "No data found for this transaction" });
    }
    return JSON.stringify({
      transaction,
      period: period ?? "24h",
      p50: data["p50(transaction.duration)"],
      p75: data["p75(transaction.duration)"],
      p95: data["p95(transaction.duration)"],
      p99: data["p99(transaction.duration)"],
      count: data["count()"],
      failureRate: data["failure_rate()"],
      apdex: data["apdex()"],
    });
  },
});

function mapSortField(sort: string): string {
  switch (sort) {
    case "p50":
      return "-p50(transaction.duration)";
    case "p95":
      return "-p95(transaction.duration)";
    case "count":
      return "-count()";
    case "failure_rate":
      return "-failure_rate()";
    default:
      return `-${sort}`;
  }
}
