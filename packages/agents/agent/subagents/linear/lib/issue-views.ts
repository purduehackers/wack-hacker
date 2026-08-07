import { z } from "zod";

import { linear, issueFilter } from "./client.ts";
import { defineTool } from "./define-tool.ts";

export const query_issue_view = defineTool({
  name: "query_issue_view",
  domain: "linear",
  description:
    "Query issues with filters. Supports filtering by team, project, assignee, status, label, and cycle. Returns identifier, title, priority, state, assignee, and URL for each issue. Paged (max 50).",
  access: { risk: "read" },
  input: z.object({
    teamId: z.string().optional(),
    projectId: z.string().optional(),
    assigneeId: z.string().optional(),
    stateId: z.string().optional(),
    labelId: z.string().optional(),
    cycleId: z.string().optional(),
    first: z.number().optional().default(25).describe("Max 50"),
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
