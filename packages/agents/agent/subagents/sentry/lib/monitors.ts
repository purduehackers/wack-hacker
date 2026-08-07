import {
  retrieveMonitorsForAnOrganization,
  retrieveAMonitor,
  retrieveCheckInsForAMonitor,
  deleteAMonitorOrMonitorEnvironments,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg, sentryProjectId, sentryPut } from "./client.ts";

const monitorProjectionSchema = z.looseObject({
  lastCheckIn: z.string().nullish(),
  nextCheckIn: z.string().nullish(),
});

/** List cron monitors for the organization. */
export const list_monitors = defineTool({
  description:
    "List cron monitors (scheduled jobs) in the Sentry organization. Returns name, status, schedule, and last/next check-in times.",
  access: { risk: "read" },
  input: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, cursor }) => {
    const projectId = project_slug === undefined ? undefined : await sentryProjectId(project_slug);
    const result = await retrieveMonitorsForAnOrganization({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        ...(projectId === undefined ? {} : { project: [projectId] }),
        ...(cursor === undefined ? {} : { cursor }),
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

/** Get full details for a cron monitor. */
export const get_monitor = defineTool({
  description:
    "Get full details for a Sentry cron monitor — schedule config, margins, runtime limits, and check-in history.",
  access: { risk: "read" },
  input: z.object({
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

/** List check-ins for a cron monitor. */
export const list_monitor_checkins = defineTool({
  description:
    "List check-ins for a cron monitor. Shows status (ok, missed, error, in_progress), duration, and timestamps.",
  access: { risk: "read" },
  input: z.object({
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

/** Update a cron monitor's configuration. */
export const update_monitor = defineTool({
  description: "Update a Sentry cron monitor's name, schedule, or runtime configuration.",
  access: { risk: "write" },
  input: z.object({
    monitor_slug: z.string().describe("Monitor slug"),
    name: z.string().optional().describe("New monitor name"),
    slug: z.string().optional().describe("New monitor slug"),
    schedule_type: z.enum(["crontab", "interval"]).optional().describe("Schedule type"),
    schedule: z
      .union([z.string(), z.tuple([z.number(), z.enum(["minute", "hour", "day"])])])
      .optional()
      .describe(
        "Crontab expression string (e.g. '0 * * * *') or interval tuple (e.g. [10, 'minute'])",
      ),
    checkin_margin: z
      .number()
      .optional()
      .describe("Minutes before a check-in is considered missed"),
    max_runtime: z
      .number()
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
      ...(resolvedCheckinMargin === undefined ? {} : { checkin_margin: resolvedCheckinMargin }),
      ...(resolvedMaxRuntime === undefined ? {} : { max_runtime: resolvedMaxRuntime }),
      ...(resolvedTimezone === undefined ? {} : { timezone: resolvedTimezone }),
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

/** Delete a cron monitor. */
export const delete_monitor = defineTool({
  description: "Permanently delete a Sentry cron monitor. This action cannot be undone.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
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
