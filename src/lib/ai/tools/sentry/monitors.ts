import {
  retrieveMonitorsForAnOrganization,
  retrieveAMonitor,
  retrieveCheckInsForAMonitor,
  updateAMonitor,
  deleteAMonitorOrMonitorEnvironments,
  unwrapResult,
} from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { admin } from "../../skills/index.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

/** List cron monitors for the organization. */
export const list_monitors = tool({
  description:
    "List cron monitors (scheduled jobs) in the Sentry organization. Returns name, status, schedule, and last/next check-in times.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, cursor }) => {
    const result = await retrieveMonitorsForAnOrganization({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        project: project_slug ? ([project_slug] as unknown as number[]) : undefined,
        cursor,
      },
    });
    const { data } = unwrapResult(result, "listMonitors");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        status: m.status,
        schedule: (m.config as Record<string, unknown>)?.schedule,
        scheduleType: (m.config as Record<string, unknown>)?.schedule_type,
        timezone: (m.config as Record<string, unknown>)?.timezone,
        project: (m.project as Record<string, unknown> | undefined)?.slug,
        lastCheckIn: m.lastCheckIn,
        nextCheckIn: m.nextCheckIn,
      })),
    );
  },
});

/** Get full details for a cron monitor. */
export const get_monitor = tool({
  description:
    "Get full details for a Sentry cron monitor — schedule config, margins, runtime limits, and check-in history.",
  inputSchema: z.object({
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
export const list_monitor_checkins = tool({
  description:
    "List check-ins for a cron monitor. Shows status (ok, missed, error, in_progress), duration, and timestamps.",
  inputSchema: z.object({
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
      query: { cursor },
    });
    const { data } = unwrapResult(result, "listMonitorCheckins");
    return JSON.stringify(data);
  },
});

/** Update a cron monitor's configuration. */
export const update_monitor = tool({
  description: "Update a Sentry cron monitor's name, schedule, or runtime configuration.",
  inputSchema: z.object({
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
    const current = existing as Record<string, unknown>;
    const currentConfig = current.config as Record<string, unknown>;

    const monitorConfig: Parameters<typeof updateAMonitor>[0]["body"]["config"] = {
      schedule_type: (schedule_type ?? currentConfig.schedule_type) as "crontab" | "interval",
      schedule: schedule ?? currentConfig.schedule,
      checkin_margin: checkin_margin ?? (currentConfig.checkin_margin as number | undefined),
      max_runtime: max_runtime ?? (currentConfig.max_runtime as number | undefined),
      timezone: (timezone ?? currentConfig.timezone) as Parameters<
        typeof updateAMonitor
      >[0]["body"]["config"]["timezone"],
    };

    const result = await updateAMonitor({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        monitor_id_or_slug: monitor_slug,
      },
      body: {
        name: name ?? (current.name as string),
        slug: slug ?? (current.slug as string),
        config: monitorConfig,
        project: (current.project as Record<string, unknown> | undefined)?.slug as string,
      },
    });
    const { data } = unwrapResult(result, "updateMonitor");
    return JSON.stringify(data);
  },
});

/** Delete a cron monitor. */
export const delete_monitor = admin(
  approval(
    tool({
      description: "Permanently delete a Sentry cron monitor. This action cannot be undone.",
      inputSchema: z.object({
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
    }),
  ),
);
