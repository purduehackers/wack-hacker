import { tool } from "ai";
import { z } from "zod";

import { sentryOrg, sentryGet, sentryMutate } from "./client.ts";

interface SentryTag {
  key: string;
  name: string;
  totalValues: number;
  topValues: Array<{ value: string; count: number; name: string }>;
}

interface SentryTagValue {
  value: string;
  count: number;
  name: string;
  firstSeen: string;
  lastSeen: string;
}

/** Update a Sentry issue's status, assignee, or priority. */
export const update_issue = tool({
  description:
    "Update a Sentry issue — resolve, ignore, assign, set priority, or bookmark. Use status 'resolved', 'ignored', or 'unresolved'.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
    status: z.enum(["resolved", "unresolved", "ignored"]).optional().describe("New issue status"),
    assigned_to: z
      .string()
      .optional()
      .describe("Assign to user ('username'), team ('team:slug'), or '' to unassign"),
    has_seen: z.boolean().optional().describe("Mark as seen/unseen"),
    is_bookmarked: z.boolean().optional().describe("Bookmark/unbookmark"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    status_details: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Status details (e.g. { inNextRelease: true } for resolve, { ignoreDuration: 30 } for ignore)",
      ),
    substatus: z
      .enum(["archived_until_escalating", "archived_until_condition_met", "archived_forever"])
      .optional()
      .describe("Substatus for ignored issues"),
  }),
  execute: async ({ issue_id, ...input }) => {
    const body: Record<string, unknown> = {};
    if (input.status !== undefined) body.status = input.status;
    if (input.assigned_to !== undefined) body.assignedTo = input.assigned_to;
    if (input.has_seen !== undefined) body.hasSeen = input.has_seen;
    if (input.is_bookmarked !== undefined) body.isBookmarked = input.is_bookmarked;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.status_details !== undefined) body.statusDetails = input.status_details;
    if (input.substatus !== undefined) body.substatus = input.substatus;
    const data = await sentryMutate(`/issues/${issue_id}/`, "PUT", body);
    return JSON.stringify(data);
  },
});

/** Delete a Sentry issue permanently. */
export const delete_issue = tool({
  description: "Permanently delete a Sentry issue. This action cannot be undone.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    await sentryMutate(`/issues/${issue_id}/`, "DELETE");
    return JSON.stringify({ deleted: true });
  },
});

/** Bulk update multiple issues at once. */
export const bulk_update_issues = tool({
  description:
    "Bulk update multiple Sentry issues. Can resolve, ignore, or assign multiple issues at once.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    issue_ids: z.array(z.string()).describe("Array of issue IDs to update"),
    status: z.enum(["resolved", "unresolved", "ignored"]).optional(),
    assigned_to: z.string().optional(),
    has_seen: z.boolean().optional(),
    is_bookmarked: z.boolean().optional(),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  }),
  execute: async ({ project_slug, issue_ids, ...input }) => {
    const params = new URLSearchParams();
    for (const id of issue_ids) params.append("id", id);
    const body: Record<string, unknown> = {};
    if (input.status !== undefined) body.status = input.status;
    if (input.assigned_to !== undefined) body.assignedTo = input.assigned_to;
    if (input.has_seen !== undefined) body.hasSeen = input.has_seen;
    if (input.is_bookmarked !== undefined) body.isBookmarked = input.is_bookmarked;
    if (input.priority !== undefined) body.priority = input.priority;
    const data = await sentryMutate(
      `/projects/${sentryOrg()}/${project_slug}/issues/?${params}`,
      "PUT",
      body,
    );
    return JSON.stringify(data);
  },
});

/** List tag distributions for a Sentry issue. */
export const list_issue_tags = tool({
  description:
    "List tag distributions for a Sentry issue. Shows tag keys (browser, os, environment, etc.) with value counts.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    const data = await sentryGet<SentryTag[]>(`/issues/${issue_id}/tags/`);
    return JSON.stringify(
      data.map((t) => ({
        key: t.key,
        name: t.name,
        totalValues: t.totalValues,
        topValues: t.topValues.slice(0, 5),
      })),
    );
  },
});

/** Get values for a specific tag on a Sentry issue. */
export const get_issue_tag_values = tool({
  description: "Get values for a specific tag on a Sentry issue, with occurrence counts.",
  inputSchema: z.object({
    issue_id: z.string().describe("Sentry issue ID (numeric)"),
    tag_key: z.string().describe("Tag key (e.g. 'browser', 'os', 'environment')"),
  }),
  execute: async ({ issue_id, tag_key }) => {
    const data = await sentryGet<SentryTagValue[]>(
      `/issues/${issue_id}/tags/${encodeURIComponent(tag_key)}/values/`,
    );
    return JSON.stringify(
      data.map((v) => ({
        value: v.value,
        name: v.name,
        count: v.count,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
      })),
    );
  },
});
