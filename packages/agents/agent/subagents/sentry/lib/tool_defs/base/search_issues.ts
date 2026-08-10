import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg, sentryProjectId, sentryResponse } from "../../client.ts";
import { perPageField } from "../../constants.ts";

const issueListResponseSchema = z.array(
  z.looseObject({
    id: z.string(),
    shortId: z.string(),
    title: z.string(),
    status: z.string(),
    level: z.string(),
    count: z.union([z.string(), z.number()]),
    userCount: z.number(),
    firstSeen: z.string(),
    lastSeen: z.string(),
    permalink: z.string(),
    project: z.looseObject({ slug: z.string() }).optional(),
  }),
);

export const search_issues = defineTool({
  description:
    "Search Sentry issues across the organization. Supports Sentry search syntax (e.g. 'is:unresolved', 'assigned:me', 'level:error', 'first-seen:-24h'). Returns issue ID, short ID, title, status, level, count, first/last seen, and URL.",
  access: { risk: "read" },
  input: z.strictObject({
    query: z.string().optional().describe("Sentry search query (e.g. 'is:unresolved level:error')"),
    project_slug: z.string().optional().describe("Filter by project slug"),
    sort: z.enum(["date", "new", "freq", "priority"]).optional(),
    per_page: perPageField,
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  }),
  execute: async ({ query, project_slug, sort, per_page, cursor }) => {
    const projectId = project_slug === undefined ? undefined : await sentryProjectId(project_slug);
    const data = sentryResponse(
      issueListResponseSchema,
      await sentryGet(`/organizations/${sentryOrg()}/issues/`, {
        query,
        project: projectId,
        sort,
        limit: per_page,
        cursor,
      }),
    );
    return JSON.stringify(
      data.map((i) => ({
        id: i.id,
        shortId: i.shortId,
        title: i.title,
        status: i.status,
        level: i.level,
        count: i.count,
        userCount: i.userCount,
        firstSeen: i.firstSeen,
        lastSeen: i.lastSeen,
        permalink: i.permalink,
        project: i.project?.slug,
      })),
    );
  },
});
