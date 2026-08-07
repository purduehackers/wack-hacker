import {
  listAnOrganization_sProjects,
  retrieveAProject,
  retrieveAnIssue,
  unwrapResult,
} from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOpts, sentryOrg, sentryProjectId } from "./client.ts";
import { perPageField } from "./constants.ts";

const projectProjectionSchema = z.looseObject({ status: z.string().nullish() });
const issueProjectionSchema = z.looseObject({ priority: z.string().nullish() });
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

/** List all projects in the Sentry organization. */
export const list_projects = defineTool({
  description:
    "List all projects in the Sentry organization. Returns slug, name, platform, date created, and status.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await listAnOrganization_sProjects({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
    });
    const { data } = unwrapResult(result, "listProjects");
    return JSON.stringify(
      data.map((project) => ({
        id: project.id,
        slug: project.slug,
        name: project.name,
        platform: project.platform,
        dateCreated: project.dateCreated,
        status: projectProjectionSchema.parse(project).status,
      })),
    );
  },
});

/** Get full details for a single Sentry project. */
export const get_project = defineTool({
  description:
    "Get full details for a Sentry project — platform, team, features, date created, and configuration.",
  access: { risk: "read" },
  input: z.object({
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
export const search_issues = defineTool({
  description:
    "Search Sentry issues across the organization. Supports Sentry search syntax (e.g. 'is:unresolved', 'assigned:me', 'level:error', 'first-seen:-24h'). Returns issue ID, short ID, title, status, level, count, first/last seen, and URL.",
  access: { risk: "read" },
  input: z.object({
    query: z.string().optional().describe("Sentry search query (e.g. 'is:unresolved level:error')"),
    project_slug: z.string().optional().describe("Filter by project slug"),
    sort: z.enum(["date", "new", "freq", "priority"]).optional(),
    per_page: perPageField,
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  }),
  execute: async ({ query, project_slug, sort, per_page, cursor }) => {
    const projectId = project_slug === undefined ? undefined : await sentryProjectId(project_slug);
    const data = issueListResponseSchema.parse(
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

/** Get full details for a single Sentry issue. */
export const get_issue = defineTool({
  description:
    "Get full details for a Sentry issue by its numeric ID. Returns title, metadata, status, assignee, tags, first/last seen, and activity.",
  access: { risk: "read" },
  input: z.object({
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
    const d = data;
    const projection = issueProjectionSchema.parse(data);
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
      project: d.project?.slug,
      metadata: d.metadata,
      type: d.type,
      priority: projection.priority,
    });
  },
});
