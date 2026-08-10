import { queryExploreEventsInTableFormat, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { escapeQuery, sentryOpts, sentryOrg } from "../../client.ts";
import { perPageField } from "../../constants.ts";

export const list_profiled_functions = defineTool({
  description:
    "List the slowest profiled functions. Shows function name, package, self-time, and total-time. Useful for finding CPU-heavy code.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    transaction: z.string().optional().describe("Filter by transaction name"),
    sort: z
      .enum(["p75()", "p95()", "p99()", "count()", "avg()"])
      .optional()
      .describe("Sort by aggregation. Defaults to 'p75()'."),
    per_page: perPageField,
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
        ...(transaction === undefined
          ? {}
          : { query: `transaction:"${escapeQuery(transaction)}"` }),
        sort: sort ? `-${sort}` : "-p75()",
        ...(per_page === undefined ? {} : { per_page }),
      },
    });
    const { data } = unwrapResult(result, "listProfiledFunctions");
    return JSON.stringify(data);
  },
});
