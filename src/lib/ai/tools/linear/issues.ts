import { tool } from "ai";
import { z } from "zod";

import { linear, applyIssueRelations } from "./client.ts";
import { issueFields, issueRelationSchema } from "./constants.ts";

export const create_issue = tool({
  description:
    "Create a new issue. Requires title and teamId. Supports setting assignee, status, priority, labels, project, due date, parent (sub-issue via parentId), and relations to other issues. Returns the issue identifier, title, and URL.",
  inputSchema: z.object({
    ...issueFields,
    title: z.string(),
    teamId: z.string(),
    relationships: issueRelationSchema,
  }),
  execute: async ({ relationships, ...input }) => {
    const payload = await linear.createIssue(input);
    const issue = await payload.issue;
    if (!issue) return "Failed to create issue";
    const relations = relationships?.length
      ? await applyIssueRelations(issue.id, relationships)
      : [];
    return JSON.stringify({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      relations,
    });
  },
});

export const update_issue = tool({
  description:
    "Update an existing issue by ID. Only include the fields you want to change — omitted fields are left unchanged. Supports changing assignee, status, priority, labels, project, due date, parent, and relations.",
  inputSchema: z.object({
    id: z.string(),
    ...issueFields,
    issueRelations: issueRelationSchema,
  }),
  execute: async ({ id, issueRelations, ...input }) => {
    const payload = await linear.updateIssue(id, input);
    const issue = await payload.issue;
    if (!issue) return "Failed to update issue";
    const relations = issueRelations?.length
      ? await applyIssueRelations(issue.id, issueRelations)
      : [];
    return JSON.stringify({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      relations,
    });
  },
});

// destructive
export const delete_issue = tool({
  description:
    "Permanently delete an issue by ID. Only use when the user explicitly asks to delete.",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const payload = await linear.deleteIssue(id);
    return JSON.stringify({ success: payload.success });
  },
});

export const query_issue_activity = tool({
  description:
    "Fetch an issue's field change history and comment thread. Use 'history' for who/when of changes, 'comments' for discussion context.",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const issue = await linear.issue(id);
    const [history, comments] = await Promise.all([issue.history(), issue.comments()]);
    return JSON.stringify({
      history: history.nodes.map((h) => ({ id: h.id, createdAt: h.createdAt })),
      comments: comments.nodes.map((c) => ({
        id: c.id,
        body: c.body?.slice(0, 500),
        createdAt: c.createdAt,
        url: c.url,
      })),
    });
  },
});
