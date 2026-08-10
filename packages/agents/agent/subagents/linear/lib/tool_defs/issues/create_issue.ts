import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { applyIssueRelations, linear } from "../../client.ts";
import { issueFields, issueRelationSchema } from "../../constants.ts";

export const create_issue = defineTool({
  description:
    "Create a new issue. Requires title and teamId. Supports setting assignee, status, priority, labels, project, due date, parent (sub-issue via parentId), and relations to other issues. Returns the issue identifier, title, and URL.",
  access: { risk: "write" },
  input: z.strictObject({
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
