import { tool } from "ai";
import { z } from "zod";

import { admin } from "../../skills/admin.ts";
import { projectPath, sentryDelete, sentryGet, sentryPaginated, sentryPut } from "./client.ts";

export const update_sentry_issue = tool({
  description: `Update a Sentry issue — resolve, ignore, assign, or change priority. Use status "resolved", "ignored", or "unresolved". Assign by username or "me".`,
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID"),
    status: z.enum(["resolved", "unresolved", "ignored"]).optional().describe("New status"),
    assignedTo: z
      .string()
      .optional()
      .describe("Username to assign to, or empty string to unassign"),
    priority: z
      .enum(["critical", "high", "medium", "low"])
      .optional()
      .describe("Issue priority level"),
    substatus: z
      .enum([
        "ongoing",
        "escalating",
        "regressed",
        "new",
        "archived_until_escalating",
        "archived_forever",
        "archived_until_condition_met",
      ])
      .optional()
      .describe("Issue substatus (used with ignored status for archive behavior)"),
  }),
  execute: async ({ issue_id, ...updates }) => {
    const result = await sentryPut<Record<string, unknown>>(`/issues/${issue_id}/`, updates);
    return JSON.stringify({
      id: result.id,
      status: result.status,
      substatus: result.substatus,
      assignedTo: result.assignedTo,
      priority: result.priority,
    });
  },
});

export const delete_sentry_issue = admin(
  tool({
    description: `Permanently delete a Sentry issue. This cannot be undone.`,
    inputSchema: z.object({
      issue_id: z.string().describe("Sentry issue ID to delete"),
    }),
    execute: async ({ issue_id }) => {
      await sentryDelete(`/issues/${issue_id}/`);
      return JSON.stringify({ deleted: true, issue_id });
    },
  }),
);

export const list_sentry_issue_events = tool({
  description: `List events (occurrences) for a specific Sentry issue. Returns event ID, timestamp, tags, and message.`,
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ issue_id, cursor }) => {
    const { results, nextCursor } = await sentryPaginated<Record<string, unknown>>(
      `/issues/${issue_id}/events/`,
      { cursor },
    );
    return JSON.stringify({
      events: results.map((e) => ({
        eventID: e.eventID,
        dateCreated: e.dateCreated,
        message: e.message ?? e.title,
        tags: e.tags,
        platform: e.platform,
      })),
      nextCursor,
    });
  },
});

export const get_sentry_event = tool({
  description: `Get full event detail — stack trace, breadcrumbs, tags, context, and user info. Use the project slug and event ID.`,
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    event_id: z.string().describe("Event ID"),
  }),
  execute: async ({ project_slug, event_id }) => {
    const event = await sentryGet<Record<string, unknown>>(
      projectPath(project_slug, `/events/${event_id}/`),
    );
    return JSON.stringify({
      eventID: event.eventID,
      dateCreated: event.dateCreated,
      message: event.message ?? event.title,
      platform: event.platform,
      tags: event.tags,
      context: event.context,
      contexts: event.contexts,
      user: event.user,
      sdk: event.sdk,
      entries: event.entries,
    });
  },
});

export const list_sentry_issue_tags = tool({
  description: `Get tag distribution for a Sentry issue — shows top values for each tag (browser, os, url, etc.) with counts.`,
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID"),
  }),
  execute: async ({ issue_id }) => {
    const tags = await sentryGet<Array<Record<string, unknown>>>(`/issues/${issue_id}/tags/`);
    return JSON.stringify(
      tags.map((t) => ({
        key: t.key,
        name: t.name,
        totalValues: t.totalValues,
        topValues: t.topValues,
      })),
    );
  },
});
