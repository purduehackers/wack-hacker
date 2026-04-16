import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

interface SentryReplay {
  id: string;
  title: string;
  project_id: string;
  duration: number;
  count_errors: number;
  count_segments: number;
  started_at: string;
  finished_at: string;
  urls: string[];
  user: { id: string; username: string; email: string; ip_address: string } | null;
  os: { name: string; version: string } | null;
  browser: { name: string; version: string } | null;
  activity: number;
}

/** List session replays. */
export const list_replays = tool({
  description:
    "List session replays for the organization. Returns replay ID, duration, error count, URLs visited, user info, and browser/OS.",
  inputSchema: z.object({
    project_slug: z.string().optional().describe("Filter by project slug"),
    query: z
      .string()
      .optional()
      .describe("Search query (e.g. 'user.email:alice@example.com', 'count_errors:>0')"),
    sort: z
      .enum(["started_at", "-started_at", "duration", "-duration", "count_errors", "-count_errors"])
      .optional(),
    per_page: z.number().max(100).optional(),
    stat_period: z.string().optional().describe("Time range (e.g. '24h', '7d'). Defaults to '7d'."),
  }),
  execute: async ({ project_slug, query, sort, per_page, stat_period }) => {
    const params = new URLSearchParams();
    params.set("statsPeriod", stat_period ?? "7d");
    if (project_slug) params.set("project", project_slug);
    if (query) params.set("query", query);
    if (sort) params.set("sort", sort);
    if (per_page) params.set("per_page", String(per_page));
    const data = await sentryGet<{ data: SentryReplay[] }>(
      `/organizations/${sentryOrg()}/replays/?${params}`,
    );
    return JSON.stringify(
      data.data.map((r) => ({
        id: r.id,
        title: r.title,
        duration: r.duration,
        countErrors: r.count_errors,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        urls: r.urls?.slice(0, 10),
        user: r.user,
        browser: r.browser,
        os: r.os,
        activity: r.activity,
      })),
    );
  },
});

/** Get details for a specific session replay. */
export const get_replay = tool({
  description:
    "Get full details for a session replay — duration, error count, URLs, user info, browser/OS, and segment count.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    replay_id: z.string().describe("Replay ID"),
  }),
  execute: async ({ project_slug, replay_id }) => {
    const data = await sentryGet<{ data: SentryReplay }>(
      `/projects/${sentryOrg()}/${project_slug}/replays/${replay_id}/`,
    );
    return JSON.stringify(data.data);
  },
});
