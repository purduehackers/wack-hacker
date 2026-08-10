import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const get_user_assigned_issues = defineTool({
  description:
    "List open issues assigned to a user. Returns identifier, title, priority, state, and URL. Use for 'what's X working on?' or 'show my issues'.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("User UUID"),
    first: z.int().min(1).default(25).describe("Max results (default 25)"),
  }),
  execute: async ({ id, first }) => {
    const u = await linear.user(id);
    const issues = await u.assignedIssues({ first });
    const results = await Promise.all(
      issues.nodes.map(async (i) => {
        const state = await i.state;
        return {
          id: i.id,
          identifier: i.identifier,
          title: i.title,
          priority: i.priorityLabel,
          state: state?.name,
          url: i.url,
        };
      }),
    );
    return JSON.stringify(results);
  },
});
