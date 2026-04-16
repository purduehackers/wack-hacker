import { tool } from "ai";
import { z } from "zod";

import { sentryOrg, sentryGet } from "./client.ts";

interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  dateCreated: string;
  status: string;
}

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  status: string;
  level: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  project: { slug: string };
  metadata: Record<string, unknown>;
  type: string;
  priority: string;
  assignedTo: { name: string; type: string } | null;
}

/** List all projects in the Sentry organization. */
export const list_projects = tool({
  description:
    "List all projects in the Sentry organization. Returns slug, name, platform, date created, and status.",
  inputSchema: z.object({}),
  execute: async () => {
    const data = await sentryGet<SentryProject[]>(`/organizations/${sentryOrg()}/projects/`);
    return JSON.stringify(
      data.map((p) => ({
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
    const data = await sentryGet(`/projects/${sentryOrg()}/${project_slug}/`);
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
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (project_slug) params.set("project", project_slug);
    if (sort) params.set("sort", sort);
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryIssue[]>(`/organizations/${sentryOrg()}/issues/?${params}`);
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

/** Get full details for a single Sentry issue. */
export const get_issue = tool({
  description:
    "Get full details for a Sentry issue by its numeric ID. Returns title, metadata, status, assignee, tags, first/last seen, and activity.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    const data = await sentryGet<SentryIssue>(`/issues/${issue_id}/`);
    return JSON.stringify({
      id: data.id,
      shortId: data.shortId,
      title: data.title,
      culprit: data.culprit,
      status: data.status,
      level: data.level,
      count: data.count,
      userCount: data.userCount,
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
      permalink: data.permalink,
      assignedTo: data.assignedTo,
      project: data.project?.slug,
      metadata: data.metadata,
      type: data.type,
      priority: data.priority,
    });
  },
});
