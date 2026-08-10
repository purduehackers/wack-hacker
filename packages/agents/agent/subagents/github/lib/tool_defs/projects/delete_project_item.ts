import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";

export const delete_project_item = defineTool({
  description: `Remove an item from a GitHub Project v2. This only removes it from the project board -- it does not delete the underlying issue or pull request.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id: z.string().describe("Project node ID"),
    item_id: z.string().describe("Project item node ID to remove"),
  }),
  execute: async ({ project_id, item_id }) => {
    await octokit().graphql(
      `mutation($projectId: ID!, $itemId: ID!) {
        deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
          deletedItemId
        }
      }`,
      { projectId: project_id, itemId: item_id },
    );
    return JSON.stringify({ deleted: true, item_id });
  },
});
