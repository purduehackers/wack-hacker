import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { issueFilter, linear } from "../../client.ts";

export const query_issue_view = defineTool({
  description:
    "Query issues with filters. Supports filtering by team, project, assignee, status, label, and cycle. Returns identifier, title, priority, state, assignee, and URL for each issue. Paged (max 50).",
  access: { risk: "read" },
  input: z.strictObject({
    teamId: z.string().optional(),
    projectId: z.string().optional(),
    assigneeId: z.string().optional(),
    stateId: z.string().optional(),
    labelId: z.string().optional(),
    cycleId: z.string().optional(),
    first: z.int().min(1).default(25).describe("Max 50"),
  }),
  execute: async ({ first, ...filters }) => {
    const issues = await linear.issues({
      filter: issueFilter(filters),
      first: Math.min(first, 50),
    });
    const results = await Promise.all(
      issues.nodes.map(async (i) => {
        const [state, assignee] = await Promise.all([i.state, i.assignee]);
        return {
          id: i.id,
          identifier: i.identifier,
          title: i.title,
          priority: i.priorityLabel,
          state: state?.name,
          assignee: assignee?.name,
          url: i.url,
        };
      }),
    );
    return JSON.stringify(results);
  },
});
