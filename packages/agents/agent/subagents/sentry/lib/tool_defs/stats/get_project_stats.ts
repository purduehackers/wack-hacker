import { retrieveEventCountsForAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const get_project_stats = defineTool({
  description:
    "Get event statistics for a specific Sentry project — volume over time broken down by outcome.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    stat: z
      .enum(["received", "rejected", "blacklisted"])
      .optional()
      .describe("Stat category. Defaults to 'received'."),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, stat, stat_period }) => {
    const period = stat_period ?? "24h";
    const hours = period.endsWith("d")
      ? Number(period.slice(0, -1)) * 24
      : Number(period.slice(0, -1));
    const since = String(Math.floor(Date.now() / 1000) - hours * 3600);
    const result = await retrieveEventCountsForAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      query: {
        stat: stat ?? "received",
        since,
      },
    });
    const { data } = unwrapResult(result, "getProjectStats");
    return JSON.stringify(data);
  },
});
