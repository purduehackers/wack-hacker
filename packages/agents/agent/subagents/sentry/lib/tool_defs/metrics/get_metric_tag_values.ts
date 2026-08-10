import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg } from "../../client.ts";

export const get_metric_tag_values = defineTool({
  description: "Get values for a specific metric tag key.",
  access: { risk: "read" },
  input: z.strictObject({
    tag_key: z.string().describe("Tag key to list values for"),
    project_slug: z.string().optional().describe("Filter by project slug"),
    metric: z.string().optional().describe("Filter by metric MRI"),
  }),
  execute: async ({ tag_key, project_slug, metric }) => {
    const data = await sentryGet(
      `/organizations/${sentryOrg()}/metrics/tags/${encodeURIComponent(tag_key)}/`,
      { project: project_slug, metric },
    );
    return JSON.stringify(data);
  },
});
