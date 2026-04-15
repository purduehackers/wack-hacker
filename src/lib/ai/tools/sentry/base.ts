import { tool } from "ai";
import { z } from "zod";

import { orgPath, projectPath, sentryGet, sentryPaginated } from "./client.ts";

export const list_sentry_projects = tool({
  description: `List all Sentry projects in the organization. Returns project slug, name, platform, and date created.`,
  inputSchema: z.object({
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  }),
  execute: async ({ cursor }) => {
    const { results, nextCursor } = await sentryPaginated<Record<string, unknown>>(
      orgPath("/projects/"),
      { cursor },
    );
    return JSON.stringify({
      projects: results.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        platform: p.platform,
        dateCreated: p.dateCreated,
        status: p.status,
      })),
      nextCursor,
    });
  },
});

export const search_sentry_issues = tool({
  description: `Search Sentry issues using Sentry's search syntax. Examples: "is:unresolved", "TypeError", "is:unresolved assigned:me level:error". Returns issue title, culprit, event count, first/last seen, and permalink.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug to search in"),
    query: z.string().describe("Sentry search query (e.g. 'is:unresolved TypeError')"),
    sort: z
      .enum(["date", "new", "freq", "priority"])
      .optional()
      .describe("Sort order: date (last seen), new (first seen), freq (event count), priority"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, query, sort, cursor }) => {
    const { results, nextCursor } = await sentryPaginated<Record<string, unknown>>(
      projectPath(project_slug, "/issues/"),
      { query, sort, cursor },
    );
    return JSON.stringify({
      issues: results.map((i) => ({
        id: i.id,
        shortId: i.shortId,
        title: i.title,
        culprit: i.culprit,
        level: i.level,
        status: i.status,
        count: i.count,
        userCount: i.userCount,
        firstSeen: i.firstSeen,
        lastSeen: i.lastSeen,
        permalink: i.permalink,
        assignedTo: i.assignedTo,
        priority: i.priority,
      })),
      nextCursor,
    });
  },
});

export const get_sentry_issue = tool({
  description: `Get detailed information about a specific Sentry issue by ID. Returns title, metadata, stats, tags, and latest event summary.`,
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID"),
  }),
  execute: async ({ issue_id }) => {
    const issue = await sentryGet<Record<string, unknown>>(`/issues/${issue_id}/`);
    return JSON.stringify({
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      level: issue.level,
      status: issue.status,
      substatus: issue.substatus,
      count: issue.count,
      userCount: issue.userCount,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      permalink: issue.permalink,
      assignedTo: issue.assignedTo,
      priority: issue.priority,
      platform: issue.platform,
      project: issue.project,
      type: issue.type,
      metadata: issue.metadata,
      tags: issue.tags,
    });
  },
});
