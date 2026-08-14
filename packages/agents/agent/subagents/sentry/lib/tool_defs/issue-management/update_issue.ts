import { updateAnIssue, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const update_issue = defineTool({
  description:
    "Update a Sentry issue — resolve, ignore, assign, set priority, or bookmark. Use status 'resolved', 'ignored', or 'unresolved'.",
  access: { risk: "write" },
  input: z.strictObject({
    issue_id: sentryNumericId.describe("Sentry issue ID (numeric)"),
    status: z.enum(["resolved", "unresolved", "ignored"]).optional().describe("New issue status"),
    assigned_to: z
      .string()
      .optional()
      .describe("Assign to user ('username'), team ('team:slug'), or '' to unassign"),
    has_seen: z.boolean().optional().describe("Mark as seen/unseen"),
    is_bookmarked: z.boolean().optional().describe("Bookmark/unbookmark"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    status_details: z
      .record(z.string(), z.json())
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
    const body = {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.assigned_to !== undefined && { assignedTo: input.assigned_to }),
      ...(input.has_seen !== undefined && { hasSeen: input.has_seen }),
      ...(input.is_bookmarked !== undefined && { isBookmarked: input.is_bookmarked }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.status_details !== undefined && { statusDetails: input.status_details }),
      ...(input.substatus !== undefined && { substatus: input.substatus }),
    };
    const result = await updateAnIssue({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id,
      },
      body,
    });
    const { data } = unwrapResult(result, "updateIssue");
    return JSON.stringify(data);
  },
});
