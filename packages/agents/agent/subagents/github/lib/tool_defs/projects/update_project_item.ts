import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { isoDateOrDateTime } from "../../constants.ts";

export const update_project_item = defineTool({
  description: `Update a field value on a project item in a GitHub Project v2. Use get_project to find field IDs. Value must match the field type: text, number, date (ISO 8601), or singleSelectOptionId.`,
  access: { risk: "write" },
  input: z.strictObject({
    project_id: z.string().describe("Project node ID"),
    item_id: z.string().describe("Project item node ID"),
    field_id: z.string().describe("Field node ID"),
    value: z
      .xor([
        z.strictObject({ text: z.string() }),
        z.strictObject({ number: z.number() }),
        z.strictObject({ date: isoDateOrDateTime }),
        z.strictObject({ singleSelectOptionId: z.string() }),
      ])
      .describe("Field value to set — exactly one of text, number, date or singleSelectOptionId"),
  }),
  execute: async ({ project_id, item_id, field_id, value }) => {
    await octokit().graphql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
        projectV2Item { id }
      }
    }`,
      { projectId: project_id, itemId: item_id, fieldId: field_id, value },
    );
    return JSON.stringify({ updated: true, item_id });
  },
});
