import { retrieveMonitorsForAnOrganization, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg, sentryProjectId } from "../../client.ts";

// Read-only projection over fields the generated SDK type omits: an unexpected
// shape must degrade to "absent" rather than fail the tool.
const monitorProjectionSchema = z.looseObject({
  lastCheckIn: z.string().nullish().catch(undefined),
  nextCheckIn: z.string().nullish().catch(undefined),
});

export const list_monitors = defineTool({
  description:
    "List cron monitors (scheduled jobs) in the Sentry organization. Returns name, status, schedule, and last/next check-in times.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().optional().describe("Filter by project slug"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, cursor }) => {
    const projectId = project_slug === undefined ? undefined : await sentryProjectId(project_slug);
    const result = await retrieveMonitorsForAnOrganization({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        ...(projectId !== undefined && { project: [projectId] }),
        ...(cursor !== undefined && { cursor }),
      },
    });
    const { data } = unwrapResult(result, "listMonitors");
    return JSON.stringify(
      data.map((monitor) => {
        const projection = monitorProjectionSchema.parse(monitor);
        return {
          id: monitor.id,
          slug: monitor.slug,
          name: monitor.name,
          status: monitor.status,
          schedule: monitor.config.schedule,
          scheduleType: monitor.config.schedule_type,
          timezone: monitor.config.timezone,
          project: monitor.project.slug,
          lastCheckIn: projection.lastCheckIn,
          nextCheckIn: projection.nextCheckIn,
        };
      }),
    );
  },
});
