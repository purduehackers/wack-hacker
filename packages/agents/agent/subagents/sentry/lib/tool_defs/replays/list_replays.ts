import { listAnOrganization_sReplays, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg, sentryProjectId } from "../../client.ts";
import { perPageField } from "../../constants.ts";

// Read-only projection over a field the generated SDK type omits: an unexpected
// shape must degrade to "absent" rather than fail the tool.
const replayProjectionSchema = z.looseObject({ title: z.string().nullish().catch(undefined) });

export const list_replays = defineTool({
  description:
    "List session replays for the organization. Returns replay ID, duration, error count, URLs visited, user info, and browser/OS.",
  access: { risk: "read" },
  input: z.strictObject({
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
    const projectId = project_slug === undefined ? undefined : await sentryProjectId(project_slug);
    const result = await listAnOrganization_sReplays({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        ...(projectId !== undefined && { project: [projectId] }),
        statsPeriod: stat_period ?? "7d",
        ...(per_page !== undefined && { per_page }),
        ...(query !== undefined && { query }),
        ...(sort !== undefined && { sort }),
      },
    });
    const { data } = unwrapResult(result, "listReplays");
    return JSON.stringify(
      data.map((replay) => ({
        id: replay.id,
        title: replayProjectionSchema.parse(replay).title,
        duration: replay.duration,
        countErrors: replay.count_errors,
        startedAt: replay.started_at,
        finishedAt: replay.finished_at,
        urls: replay.urls?.slice(0, 10),
        user: replay.user,
        browser: replay.browser,
        os: replay.os,
        activity: replay.activity,
      })),
    );
  },
});
