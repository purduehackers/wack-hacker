import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { applyIssueRelations, linear } from "../../client.ts";
import { issueFields, issueRelationSchema } from "../../constants.ts";

export const update_issue = defineTool({
  description:
    "Update an existing issue by ID. Only include the fields you want to change — omitted fields are left unchanged. Supports changing assignee, status, priority, labels, project, due date, parent, and relations.",
  access: { risk: "write" },
  input: z.strictObject({
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
