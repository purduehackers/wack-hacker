import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOrg, sentryPut } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const bulk_update_issues = defineTool({
  description:
    "Bulk update multiple Sentry issues. Can resolve, ignore, or assign multiple issues at once.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    issue_ids: z.array(sentryNumericId).describe("Array of issue IDs to update"),
    status: z.enum(["resolved", "unresolved", "ignored"]).optional(),
    assigned_to: z.string().optional(),
    has_seen: z.boolean().optional(),
    is_bookmarked: z.boolean().optional(),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  }),
  execute: async ({ project_slug, issue_ids, ...input }) => {
    const body = {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.assigned_to !== undefined && { assignedTo: input.assigned_to }),
      ...(input.has_seen !== undefined && { hasSeen: input.has_seen }),
      ...(input.is_bookmarked !== undefined && { isBookmarked: input.is_bookmarked }),
      ...(input.priority !== undefined && { priority: input.priority }),
    };
    const data = await sentryPut(
      `/projects/${sentryOrg()}/${project_slug}/issues/`,
      { id: issue_ids.map(Number) },
      body,
    );
    return JSON.stringify(data);
  },
});
