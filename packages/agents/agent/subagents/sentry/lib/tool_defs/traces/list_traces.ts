import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg } from "../../client.ts";
import { perPageField } from "../../constants.ts";

export const list_traces = defineTool({
  description:
    "Search for traces in the organization. Returns trace IDs with summary info like duration, span count, and root transaction.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Filter query (e.g. 'transaction:GET /api/users')"),
    sort: z.string().optional().describe("Sort field (e.g. '-timestamp', '-duration')"),
    per_page: perPageField,
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, query, sort, per_page, stat_period }) => {
    const fields = ["trace", "transaction", "count()", "min(timestamp)", "max(timestamp)"];
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/`, {
      dataset: "discover",
      project: project_slug,
      statsPeriod: stat_period ?? "24h",
      field: fields,
      query: query ? `event.type:transaction ${query}` : "event.type:transaction",
      sort,
      per_page,
    });
    return JSON.stringify(data);
  },
});
