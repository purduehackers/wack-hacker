import { tool } from "ai";
import { z } from "zod";

import { sentryOrg, sentryGet } from "./client.ts";

interface SentryEvent {
  eventID: string;
  id: string;
  title: string;
  message: string;
  dateCreated: string;
  tags: Array<{ key: string; value: string }>;
}

interface SentryEventDetail extends SentryEvent {
  context: Record<string, unknown>;
  contexts: Record<string, unknown>;
  entries: Array<{ type: string; data: unknown }>;
  sdk: { name: string; version: string } | null;
  user: Record<string, unknown> | null;
}

/** List events (occurrences) for a Sentry issue. */
export const list_issue_events = tool({
  description:
    "List events (occurrences) for a Sentry issue. Returns event ID, title, timestamp, and tags.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
    per_page: z.number().max(100).optional(),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ issue_id, per_page, cursor }) => {
    const params = new URLSearchParams();
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryEvent[]>(`/issues/${issue_id}/events/?${params}`);
    return JSON.stringify(
      data.map((e) => ({
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
    const data = await sentryGet<SentryEventDetail>(
      `/projects/${sentryOrg()}/${project_slug}/events/${event_id}/`,
    );
    return JSON.stringify({
      eventID: data.eventID,
      title: data.title,
      message: data.message,
      dateCreated: data.dateCreated,
      tags: data.tags,
      contexts: data.contexts,
      entries: data.entries,
      user: data.user,
      sdk: data.sdk,
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
    const data = await sentryGet<SentryEventDetail>(`/issues/${issue_id}/events/latest/`);
    return JSON.stringify({
      eventID: data.eventID,
      title: data.title,
      message: data.message,
      dateCreated: data.dateCreated,
      tags: data.tags,
      contexts: data.contexts,
      entries: data.entries,
      user: data.user,
      sdk: data.sdk,
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
  execute: async ({ project_slug, query, per_page, cursor }) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (per_page) params.set("per_page", String(per_page));
    if (cursor) params.set("cursor", cursor);
    const data = await sentryGet<SentryEvent[]>(
      `/projects/${sentryOrg()}/${project_slug}/events/?${params}`,
    );
    return JSON.stringify(
      data.map((e) => ({
        eventID: e.eventID,
        title: e.title,
        message: e.message,
        dateCreated: e.dateCreated,
        tags: e.tags,
      })),
    );
  },
});
