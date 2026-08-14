import { retrieveAMonitor, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg, sentryPut } from "../../client.ts";

export const update_monitor = defineTool({
  description: "Update a Sentry cron monitor's name, schedule, or runtime configuration.",
  access: { risk: "write" },
  input: z.strictObject({
    monitor_slug: z.string().describe("Monitor slug"),
    name: z.string().optional().describe("New monitor name"),
    slug: z.string().optional().describe("New monitor slug"),
    schedule_type: z.enum(["crontab", "interval"]).optional().describe("Schedule type"),
    schedule: z
      .union([z.string(), z.tuple([z.int().min(1), z.enum(["minute", "hour", "day"])])])
      .optional()
      .describe(
        "Crontab expression string (e.g. '0 * * * *') or interval tuple (e.g. [10, 'minute'])",
      ),
    checkin_margin: z
      .int()
      .min(0)
      .optional()
      .describe("Minutes before a check-in is considered missed"),
    max_runtime: z
      .int()
      .min(1)
      .optional()
      .describe("Maximum runtime in minutes before marking as failed"),
    timezone: z.string().optional().describe("Timezone (e.g. 'America/New_York')"),
  }),
  execute: async ({
    monitor_slug,
    name,
    slug,
    schedule_type,
    schedule,
    checkin_margin,
    max_runtime,
    timezone,
  }) => {
    // Fetch current monitor to get required fields for the SDK
    const getResult = await retrieveAMonitor({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        monitor_id_or_slug: monitor_slug,
      },
    });
    const { data: existing } = unwrapResult(getResult, "getMonitorForUpdate");
    const current = existing;
    const currentConfig = current.config;

    const resolvedCheckinMargin = checkin_margin ?? currentConfig.checkin_margin;
    const resolvedMaxRuntime = max_runtime ?? currentConfig.max_runtime;
    const resolvedTimezone = timezone ?? currentConfig.timezone ?? undefined;
    const monitorConfig = {
      schedule_type: schedule_type ?? currentConfig.schedule_type,
      schedule: schedule ?? currentConfig.schedule,
      ...(resolvedCheckinMargin !== undefined && { checkin_margin: resolvedCheckinMargin }),
      ...(resolvedMaxRuntime !== undefined && { max_runtime: resolvedMaxRuntime }),
      ...(resolvedTimezone !== undefined && { timezone: resolvedTimezone }),
    };

    const data = await sentryPut(
      `/organizations/${sentryOrg()}/monitors/${monitor_slug}/`,
      {},
      {
        name: name ?? current.name,
        slug: slug ?? current.slug,
        config: monitorConfig,
        project: current.project.slug,
      },
    );
    return JSON.stringify(data);
  },
});
