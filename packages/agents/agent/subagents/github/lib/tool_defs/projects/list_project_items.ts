import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, resourceId } from "../../constants.ts";
import { decodeGraphql, listProjectItemsResponseSchema } from "../../projects-graphql.ts";

export const list_project_items = defineTool({
  description: `List items in a GitHub Project v2. Returns each item's node ID, type (ISSUE, PULL_REQUEST, DRAFT_ISSUE), linked content (title, number, URL), and field values. Supports cursor-based pagination.`,
  access: { risk: "read" },
  input: z.strictObject({
    project_number: resourceId.describe("Project number"),
    first: z.int().min(1).max(50).optional(),
    after: z.string().optional().describe("Cursor for pagination"),
  }),
  execute: async ({ project_number, first, after }) => {
    const { organization } = decodeGraphql(
      listProjectItemsResponseSchema,
      await octokit().graphql(
        `query($org: String!, $number: Int!, $first: Int!, $after: String) {
      organization(login: $org) {
        projectV2(number: $number) {
          items(first: $first, after: $after) {
            nodes {
              id type
              content {
                __typename
                ... on Issue { title number url }
                ... on PullRequest { title number url }
                ... on DraftIssue { title }
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2Field { name } } }
                  ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } }
                  ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } }
                  ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2Field { name } } }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }`,
        {
          org: env.GITHUB_ORG,
          number: project_number,
          first: first ?? 20,
          after,
        },
      ),
    );
    const items = organization.projectV2.items;
    return JSON.stringify({
      items: items.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        content: n.content,
        fieldValues: n.fieldValues.nodes.flatMap((fieldValue) =>
          fieldValue.field === undefined
            ? []
            : [
                {
                  field: fieldValue.field.name,
                  value: fieldValue.text ?? fieldValue.name ?? fieldValue.date ?? fieldValue.number,
                },
              ],
        ),
      })),
      pageInfo: items.pageInfo,
    });
  },
});
