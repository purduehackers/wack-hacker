import { listAnOrganization_sReplays, retrieveAReplayInstance, unwrapResult } from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { perPageField } from "../_shared/constants.ts";
import { sentryOpts, sentryOrg } from "./client.ts";

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
    per_page: perPageField,
    stat_period: z.string().optional().describe("Time range (e.g. '24h', '7d'). Defaults to '7d'."),
  }),
  execute: async ({ project_slug, query, sort, per_page, stat_period }) => {
    const result = await listAnOrganization_sReplays({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        project: project_slug ? ([project_slug] as unknown as number[]) : undefined,
        statsPeriod: stat_period ?? "7d",
        per_page,
        query,
        sort,
      },
    });
    const { data } = unwrapResult(result, "listReplays");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id,
        title: r.title,
        duration: r.duration,
        countErrors: r.count_errors,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        urls: (r.urls as string[] | undefined)?.slice(0, 10),
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
    replay_id: z.string().describe("Replay ID"),
  }),
  execute: async ({ replay_id }) => {
    const result = await retrieveAReplayInstance({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        replay_id,
      },
    });
    const { data } = unwrapResult(result, "getReplay");
    return JSON.stringify(data);
  },
});
