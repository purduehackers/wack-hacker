import { deleteAMonitorOrMonitorEnvironments, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const delete_monitor = defineTool({
  description: "Permanently delete a Sentry cron monitor. This action cannot be undone.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    monitor_slug: z.string().describe("Monitor slug"),
  }),
  execute: async ({ monitor_slug }) => {
    const result = await deleteAMonitorOrMonitorEnvironments({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        monitor_id_or_slug: monitor_slug,
      },
    });
    unwrapResult(result, "deleteMonitor");
    return JSON.stringify({ deleted: true });
  },
});
