import { tool } from "ai";
import { z } from "zod";

import { admin } from "../../skills/index.ts";
import { sentryGet, sentryMutate, sentryOrg } from "./client.ts";

interface SentryMonitor {
  id: string;
  slug: string;
  name: string;
  status: string;
  type: string;
  config: {
    schedule_type: string;
    schedule: string | [number, string];
    checkin_margin: number | null;
    max_runtime: number | null;
    timezone: string;
  };
  project: { slug: string; id: string };
  dateCreated: string;
  lastCheckIn: string | null;
  nextCheckIn: string | null;
}

interface SentryCheckIn {
  id: string;
  status: string;
  duration: number | null;
  dateCreated: string;
  environment: string | null;
}

/** List cron monitors for the organization. */
export const list_monitors = tool({
  description:
    "List cron monitors (scheduled jobs) in the Sentry organization. Returns name, status, schedule, and last/next check-in times.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, per_page, cursor }) => {
    const params = new URLSearchParams();
    if (project_slug) params.set("project", project_slug);
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryMonitor[]>(
      `/organizations/${sentryOrg()}/monitors/?${params}`,
    );
    return JSON.stringify(
      data.map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        status: m.status,
        schedule: m.config.schedule,
        scheduleType: m.config.schedule_type,
        timezone: m.config.timezone,
        project: m.project?.slug,
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
    const data = await sentryGet<SentryMonitor>(
      `/organizations/${sentryOrg()}/monitors/${monitor_slug}/`,
    );
    return JSON.stringify(data);
  },
});

/** List check-ins for a cron monitor. */
export const list_monitor_checkins = tool({
  description:
    "List check-ins for a cron monitor. Shows status (ok, missed, error, in_progress), duration, and timestamps.",
  inputSchema: z.object({
    monitor_slug: z.string().describe("Monitor slug"),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ monitor_slug, per_page, cursor }) => {
    const params = new URLSearchParams();
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryCheckIn[]>(
      `/organizations/${sentryOrg()}/monitors/${monitor_slug}/checkins/?${params}`,
    );
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
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (slug !== undefined) body.slug = slug;
    const config: Record<string, unknown> = {};
    if (schedule_type !== undefined) config.schedule_type = schedule_type;
    if (schedule !== undefined) config.schedule = schedule;
    if (checkin_margin !== undefined) config.checkin_margin = checkin_margin;
    if (max_runtime !== undefined) config.max_runtime = max_runtime;
    if (timezone !== undefined) config.timezone = timezone;
    if (Object.keys(config).length > 0) body.config = config;
    const data = await sentryMutate(
      `/organizations/${sentryOrg()}/monitors/${monitor_slug}/`,
      "PUT",
      body,
    );
    return JSON.stringify(data);
  },
});

/** Delete a cron monitor. */
export const delete_monitor = admin(
  tool({
    description: "Permanently delete a Sentry cron monitor. This action cannot be undone.",
    inputSchema: z.object({
      monitor_slug: z.string().describe("Monitor slug"),
    }),
    execute: async ({ monitor_slug }) => {
      await sentryMutate(`/organizations/${sentryOrg()}/monitors/${monitor_slug}/`, "DELETE");
      return JSON.stringify({ deleted: true });
    },
  }),
);
