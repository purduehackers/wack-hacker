import { retrieveCheckInsForAMonitor, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_monitor_checkins = defineTool({
  description:
    "List check-ins for a cron monitor. Shows status (ok, missed, error, in_progress), duration, and timestamps.",
  access: { risk: "read" },
  input: z.strictObject({
    monitor_slug: z.string().describe("Monitor slug"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ monitor_slug, cursor }) => {
    const result = await retrieveCheckInsForAMonitor({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        monitor_id_or_slug: monitor_slug,
      },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listMonitorCheckins");
    return JSON.stringify(data);
  },
});
