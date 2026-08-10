import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg } from "../../client.ts";

export const list_metric_tags = defineTool({
  description: "List tag keys available for custom metrics filtering and grouping.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().optional().describe("Filter by project slug"),
    metric: z.string().optional().describe("Filter by metric MRI"),
  }),
  execute: async ({ project_slug, metric }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/tags/`, {
      project: project_slug,
      metric,
    });
    return JSON.stringify(data);
  },
});
