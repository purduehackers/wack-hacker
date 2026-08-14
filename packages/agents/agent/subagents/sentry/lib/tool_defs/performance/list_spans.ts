import { queryExploreEventsInTableFormat, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg, sentryProjectId } from "../../client.ts";
import { perPageField } from "../../constants.ts";

export const list_spans = defineTool({
  description:
    "Query span-level data for deeper performance analysis. Useful for finding slow database queries, HTTP calls, or specific operations.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Fields to query (e.g. ['span.op', 'span.description', 'avg(span.duration)', 'count()'])",
      ),
    query: z
      .string()
      .optional()
      .describe("Filter query (e.g. 'span.op:db span.description:*users*')"),
    sort: z.string().optional().describe("Sort field"),
    per_page: perPageField,
    stat_period: z.string().optional().describe("Time range (e.g. '24h', '7d')"),
  }),
  execute: async ({ project_slug, fields, query, sort, per_page, stat_period }) => {
    const projectId = await sentryProjectId(project_slug);
    const defaultFields = ["span.op", "span.description", "avg(span.duration)", "count()"];
    const result = await queryExploreEventsInTableFormat({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        dataset: "spans",
        field: fields ?? defaultFields,
        ...(project_slug !== undefined && { project: [projectId] }),
        statsPeriod: stat_period ?? "24h",
        ...(query !== undefined && { query }),
        ...(sort !== undefined && { sort }),
        ...(per_page !== undefined && { per_page }),
      },
    });
    const { data } = unwrapResult(result, "listSpans");
    return JSON.stringify(data);
  },
});
