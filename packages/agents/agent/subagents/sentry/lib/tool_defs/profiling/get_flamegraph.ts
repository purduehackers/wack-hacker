import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { escapeQuery, sentryGet, sentryOrg } from "../../client.ts";

export const get_flamegraph = defineTool({
  description:
    "Get flamegraph profiling data for a transaction. Shows CPU time distribution across function calls. Useful for identifying performance bottlenecks.",
  access: { risk: "read" },
  input: z.strictObject({
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
