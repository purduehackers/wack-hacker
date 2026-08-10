import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { createProjectItemResponseSchema, decodeGraphql } from "../../projects-graphql.ts";

export const create_project_item = defineTool({
  description: `Add an existing issue or pull request to a GitHub Project v2. Requires the project's node ID (from list_org_projects or get_project) and the issue/PR's node ID. Returns the new project item's ID.`,
  access: { risk: "write" },
  input: z.strictObject({
    project_id: z.string().describe("Project node ID (from list_org_projects or get_project)"),
    content_id: z.string().describe("Node ID of the issue or pull request to add"),
  }),
  execute: async ({ project_id, content_id }) => {
    const { addProjectV2ItemById } = decodeGraphql(
      createProjectItemResponseSchema,
      await octokit().graphql(
        `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
        { projectId: project_id, contentId: content_id },
      ),
    );
    return JSON.stringify({ item_id: addProjectV2ItemById.item.id });
  },
});
