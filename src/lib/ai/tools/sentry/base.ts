import {
  listAnOrganization_sProjects,
  retrieveAProject,
  listAnOrganization_sIssues,
  retrieveAnIssue,
  unwrapResult,
} from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { sentryOpts, sentryOrg } from "./client.ts";

/** List all projects in the Sentry organization. */
export const list_projects = tool({
  description:
    "List all projects in the Sentry organization. Returns slug, name, platform, date created, and status.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await listAnOrganization_sProjects({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
    });
    const { data } = unwrapResult(result, "listProjects");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        platform: p.platform,
        dateCreated: p.dateCreated,
        status: p.status,
      })),
    );
  },
});

/** Get full details for a single Sentry project. */
export const get_project = tool({
  description:
    "Get full details for a Sentry project — platform, team, features, date created, and configuration.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug (e.g. 'my-nextjs-app')"),
  }),
  execute: async ({ project_slug }) => {
    const result = await retrieveAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "getProject");
    return JSON.stringify(data);
  },
});

/** Search Sentry issues across the organization. */
export const search_issues = tool({
  description:
    "Search Sentry issues across the organization. Supports Sentry search syntax (e.g. 'is:unresolved', 'assigned:me', 'level:error', 'first-seen:-24h'). Returns issue ID, short ID, title, status, level, count, first/last seen, and URL.",
  inputSchema: z.object({
    query: z.string().optional().describe("Sentry search query (e.g. 'is:unresolved level:error')"),
    project_slug: z.string().optional().describe("Filter by project slug"),
    sort: z.enum(["date", "new", "freq", "priority"]).optional(),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  }),
  execute: async ({ query, project_slug, sort, per_page, cursor }) => {
    const result = await listAnOrganization_sIssues({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      query: {
        query,
        project: project_slug ? ([project_slug] as unknown as number[]) : undefined,
        sort: sort as "date" | "freq" | "new" | undefined,
        limit: per_page,
        cursor,
      },
    });
    const { data } = unwrapResult(result, "searchIssues");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((i) => ({
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
        project: (i.project as Record<string, unknown> | undefined)?.slug,
      })),
    );
  },
});

/** Get full details for a single Sentry issue. */
export const get_issue = tool({
  description:
    "Get full details for a Sentry issue by its numeric ID. Returns title, metadata, status, assignee, tags, first/last seen, and activity.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    const result = await retrieveAnIssue({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id,
      },
    });
    const { data } = unwrapResult(result, "getIssue");
    const d = data as Record<string, unknown>;
    return JSON.stringify({
      id: d.id,
      shortId: d.shortId,
      title: d.title,
      culprit: d.culprit,
      status: d.status,
      level: d.level,
      count: d.count,
      userCount: d.userCount,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      permalink: d.permalink,
      assignedTo: d.assignedTo,
      project: (d.project as Record<string, unknown> | undefined)?.slug,
      metadata: d.metadata,
      type: d.type,
      priority: d.priority,
    });
  },
});
