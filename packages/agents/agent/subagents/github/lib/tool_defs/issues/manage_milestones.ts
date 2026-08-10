import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, isoDateOrDateTime, repoField, resourceId } from "../../constants.ts";

export const manage_milestones = defineTool({
  description: `Create, update, or delete a milestone in a repository. For 'create', title is required. For 'update' and 'delete', milestone_number is required. Supports setting description, state, and due date.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    action: z.enum(["create", "update", "delete"]),
    milestone_number: resourceId.exactOptional().describe("Milestone number (for update/delete)"),
    title: z.string().exactOptional().describe("Title (for create/update)"),
    description: z.string().exactOptional(),
    state: z.enum(["open", "closed"]).exactOptional(),
    due_on: isoDateOrDateTime
      .exactOptional()
      .describe("Due date, ISO 8601 (e.g. '2025-12-31T00:00:00Z')"),
  }),
  execute: async ({ repo, action, milestone_number, ...fields }) => {
    switch (action) {
      case "create": {
        const { title, ...rest } = fields;
        if (title === undefined) return "title is required when creating a milestone";
        const { data } = await octokit().rest.issues.createMilestone({
          owner: env.GITHUB_ORG,
          repo,
          title,
          ...rest,
        });
        return JSON.stringify({
          number: data.number,
          title: data.title,
          html_url: data.html_url,
        });
      }
      case "update": {
        if (milestone_number === undefined) {
          return "milestone_number is required when updating a milestone";
        }
        const { data } = await octokit().rest.issues.updateMilestone({
          owner: env.GITHUB_ORG,
          repo,
          milestone_number,
          ...fields,
        });
        return JSON.stringify({
          number: data.number,
          title: data.title,
          html_url: data.html_url,
        });
      }
      case "delete":
        if (milestone_number === undefined) {
          return "milestone_number is required when deleting a milestone";
        }
        await octokit().rest.issues.deleteMilestone({
          owner: env.GITHUB_ORG,
          repo,
          milestone_number,
        });
        return JSON.stringify({ deleted: true });
    }
  },
});
