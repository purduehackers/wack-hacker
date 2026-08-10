import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg } from "../../client.ts";
import { perPageField } from "../../constants.ts";

export const list_transactions = defineTool({
  description:
    "List transaction events with performance metrics. Common fields: 'transaction', 'count()', 'p50(transaction.duration)', 'p95(transaction.duration)', 'avg(transaction.duration)'.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    fields: z
      .array(z.string())
      .describe("Fields to query (e.g. ['transaction', 'count()', 'p95(transaction.duration)'])"),
    query: z.string().optional().describe("Filter query (e.g. 'transaction.op:http.server')"),
    sort: z.string().optional().describe("Sort field with optional '-' prefix for descending"),
    per_page: perPageField,
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d', '14d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/`, {
      dataset: "discover",
      project: project_slug,
      statsPeriod: stat_period ?? "24h",
      field: fields,
      query,
      sort,
      per_page,
    });
    return JSON.stringify(data);
  },
});
