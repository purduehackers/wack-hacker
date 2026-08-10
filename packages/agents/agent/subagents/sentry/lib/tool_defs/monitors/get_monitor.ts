import { retrieveAMonitor, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const get_monitor = defineTool({
  description:
    "Get full details for a Sentry cron monitor — schedule config, margins, runtime limits, and check-in history.",
  access: { risk: "read" },
  input: z.strictObject({
    monitor_slug: z.string().describe("Monitor slug"),
  }),
  execute: async ({ monitor_slug }) => {
    const result = await retrieveAMonitor({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        monitor_id_or_slug: monitor_slug,
      },
    });
    const { data } = unwrapResult(result, "getMonitor");
    return JSON.stringify(data);
  },
});
