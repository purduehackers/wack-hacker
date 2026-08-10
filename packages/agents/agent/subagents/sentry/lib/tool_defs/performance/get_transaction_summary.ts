import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { escapeQuery, sentryGet, sentryOrg } from "../../client.ts";

export const get_transaction_summary = defineTool({
  description:
    "Get time-series performance data for a specific transaction. Useful for spotting regressions or trends.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    transaction: z.string().describe("Transaction name (e.g. 'GET /api/users')"),
    y_axis: z
      .string()
      .optional()
      .describe(
        "Metric to plot (e.g. 'p95(transaction.duration)', 'count()'). Defaults to 'p95(transaction.duration)'.",
      ),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, transaction, y_axis, stat_period }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/events-stats/`, {
      project: project_slug,
      query: `transaction:"${escapeQuery(transaction)}"`,
      yAxis: y_axis ?? "p95(transaction.duration)",
      statsPeriod: stat_period ?? "24h",
    });
    return JSON.stringify(data);
  },
});
