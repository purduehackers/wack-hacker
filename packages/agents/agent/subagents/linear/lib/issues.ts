import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear, applyIssueRelations } from "./client.ts";
import { issueFields, issueRelationSchema } from "./constants.ts";
import { sdkInput } from "./sdk-input.ts";

export const create_issue = defineTool({
  description:
    "Create a new issue. Requires title and teamId. Supports setting assignee, status, priority, labels, project, due date, parent (sub-issue via parentId), and relations to other issues. Returns the issue identifier, title, and URL.",
  access: { risk: "write" },
  input: z.object({
    ...issueFields,
    title: z.string(),
    teamId: z.string(),
    relationships: issueRelationSchema,
  }),
  execute: async ({ relationships, ...input }) => {
    const payload = await linear.createIssue(
      sdkInput<Parameters<typeof linear.createIssue>[0]>(input),
    );
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

export const update_issue = defineTool({
  description:
    "Update an existing issue by ID. Only include the fields you want to change — omitted fields are left unchanged. Supports changing assignee, status, priority, labels, project, due date, parent, and relations.",
  access: { risk: "write" },
  input: z.object({
    id: z.string(),
    ...issueFields,
    issueRelations: issueRelationSchema,
  }),
  execute: async ({ id, issueRelations, ...input }) => {
    const payload = await linear.updateIssue(
      id,
      sdkInput<Parameters<typeof linear.updateIssue>[1]>(input),
    );
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

export const delete_issue = defineTool({
  description:
    "Permanently delete an issue by ID. Only use when the user explicitly asks to delete.",
  access: { risk: "destructive" },
  input: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const payload = await linear.deleteIssue(id);
    return JSON.stringify({ success: payload.success });
  },
});

export const archive_issue = defineTool({
  description:
    "Archive an issue. Archived issues are hidden from default views but preserved. Prefer this over delete_issue for most cases.",
  access: { risk: "destructive" },
  input: z.object({ id: z.string().describe("Issue UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.archiveIssue(id);
    return JSON.stringify({ success: payload.success });
  },
});

export const unarchive_issue = defineTool({
  description: "Restore an archived issue back to its previous state.",
  access: { risk: "write" },
  input: z.object({ id: z.string().describe("Issue UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.unarchiveIssue(id);
    return JSON.stringify({ success: payload.success });
  },
});

export const query_issue_activity = defineTool({
  description:
    "Fetch an issue's field change history and comment thread. Use 'history' for who/when of changes, 'comments' for discussion context.",
  access: { risk: "read" },
  input: z.object({ id: z.string() }),
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
