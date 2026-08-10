import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg } from "../../client.ts";

export const list_metrics = defineTool({
  description:
    "List available custom metrics (counters, distributions, gauges, sets) in the Sentry organization.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().optional().describe("Filter by project slug"),
  }),
  execute: async ({ project_slug }) => {
    const data = await sentryGet(`/organizations/${sentryOrg()}/metrics/meta/`, {
      project: project_slug,
    });
    return JSON.stringify(data);
  },
});
