import {
  listAnIssue_sEvents,
  retrieveAnEventForAProject,
  retrieveAnIssueEvent,
  listAProject_sErrorEvents,
  unwrapResult,
} from "@sentry/api";
import { tool } from "ai";
import { z } from "zod";

import { sentryOpts, sentryOrg } from "./client.ts";

/** List events (occurrences) for a Sentry issue. */
export const list_issue_events = tool({
  description:
    "List events (occurrences) for a Sentry issue. Returns event ID, title, timestamp, and tags.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ issue_id, cursor }) => {
    const result = await listAnIssue_sEvents({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id: Number(issue_id),
      },
      query: { cursor },
    });
    const { data } = unwrapResult(result, "listIssueEvents");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((e) => ({
        eventID: e.eventID,
        title: e.title,
        message: e.message,
        dateCreated: e.dateCreated,
        tags: e.tags,
      })),
    );
  },
});

/** Get full event detail including stack trace, breadcrumbs, and contexts. */
export const get_event = tool({
  description:
    "Get full event detail including stack trace, breadcrumbs, and contexts. Requires both project slug and event ID.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    event_id: z.string().describe("Event ID"),
  }),
  execute: async ({ project_slug, event_id }) => {
    const result = await retrieveAnEventForAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        event_id,
      },
    });
    const { data } = unwrapResult(result, "getEvent");
    const d = data as Record<string, unknown>;
    return JSON.stringify({
      eventID: d.eventID,
      title: d.title,
      message: d.message,
      dateCreated: d.dateCreated,
      tags: d.tags,
      contexts: d.contexts,
      entries: d.entries,
      user: d.user,
      sdk: d.sdk,
    });
  },
});

/** Get the most recent event for a Sentry issue. */
export const get_latest_event = tool({
  description:
    "Get the most recent event for a Sentry issue. Returns full event detail including stack trace and breadcrumbs.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    const result = await retrieveAnIssueEvent({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id: Number(issue_id),
        event_id: "latest",
      },
    });
    const { data } = unwrapResult(result, "getLatestEvent");
    const d = data as Record<string, unknown>;
    return JSON.stringify({
      eventID: d.eventID,
      title: d.title,
      message: d.message,
      dateCreated: d.dateCreated,
      tags: d.tags,
      contexts: d.contexts,
      entries: d.entries,
      user: d.user,
      sdk: d.sdk,
    });
  },
});

/** List recent events for a project. */
export const list_project_events = tool({
  description:
    "List recent events for a Sentry project. Returns event ID, title, timestamp, and tags.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Search query to filter events"),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, cursor }) => {
    const result = await listAProject_sErrorEvents({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      query: { cursor },
    });
    const { data } = unwrapResult(result, "listProjectEvents");
    return JSON.stringify(
      (data as Array<Record<string, unknown>>).map((e) => ({
        eventID: e.eventID,
        title: e.title,
        message: e.message,
        dateCreated: e.dateCreated,
        tags: e.tags,
      })),
    );
  },
});
