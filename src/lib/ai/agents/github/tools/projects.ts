import { tool } from "ai";
import { z } from "zod";

import { octokit } from "../client";
import { ORG } from "../constants";

const json = JSON.stringify;

/** List GitHub Projects v2 in the organization. */
export const list_org_projects = tool({
  description: `List GitHub Projects v2 in the purduehackers organization. Returns each project's node ID, title, number, URL, closed status, and description. Supports cursor-based pagination.`,
  inputSchema: z.object({
    first: z.number().max(50).optional().describe("Number of projects to fetch (max 50)"),
    after: z.string().optional().describe("Cursor for pagination"),
  }),
  execute: async ({ first, after }) => {
    const { organization } = await octokit.graphql<{
      organization: {
        projectsV2: {
          nodes: {
            id: string;
            title: string;
            number: number;
            url: string;
            closed: boolean;
            shortDescription: string;
          }[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    }>(
      `query($org: String!, $first: Int!, $after: String) {
        organization(login: $org) {
          projectsV2(first: $first, after: $after) {
            nodes { id title number url closed shortDescription }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { org: ORG, first: first ?? 20, after },
    );
    return json({
      projects: organization.projectsV2.nodes,
      pageInfo: organization.projectsV2.pageInfo,
    });
  },
});

/** Get details for a specific GitHub Project v2 by number. */
export const get_project = tool({
  description: `Get detailed information about a GitHub Project v2 by its number. Returns the project's node ID, title, URL, description, readme, and all field definitions (ID, name, data type). Use field IDs when updating project items.`,
  inputSchema: z.object({
    project_number: z.number().describe("Project number"),
  }),
  execute: async ({ project_number }) => {
    const { organization } = await octokit.graphql<{
      organization: {
        projectV2: {
          id: string;
          title: string;
          number: number;
          url: string;
          closed: boolean;
          shortDescription: string;
          readme: string;
          fields: {
            nodes: { id: string; name: string; dataType: string }[];
          };
        };
      };
    }>(
      `query($org: String!, $number: Int!) {
        organization(login: $org) {
          projectV2(number: $number) {
            id title number url closed shortDescription readme
            fields(first: 30) {
              nodes { id name dataType }
            }
          }
        }
      }`,
      { org: ORG, number: project_number },
    );
    return json(organization.projectV2);
  },
});

/** List items in a GitHub Project v2. */
export const list_project_items = tool({
  description: `List items in a GitHub Project v2. Returns each item's node ID, type (ISSUE, PULL_REQUEST, DRAFT_ISSUE), linked content (title, number, URL), and field values. Supports cursor-based pagination.`,
  inputSchema: z.object({
    project_number: z.number().describe("Project number"),
    first: z.number().max(50).optional(),
    after: z.string().optional().describe("Cursor for pagination"),
  }),
  execute: async ({ project_number, first, after }) => {
    const { organization } = await octokit.graphql<{
      organization: {
        projectV2: {
          items: {
            nodes: {
              id: string;
              type: string;
              content: { __typename: string; title?: string; number?: number; url?: string } | null;
              fieldValues: {
                nodes: {
                  field?: { name: string };
                  text?: string;
                  name?: string;
                  date?: string;
                  number?: number;
                }[];
              };
            }[];
            pageInfo: { hasNextPage: boolean; endCursor: string };
          };
        };
      };
    }>(
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
      { org: ORG, number: project_number, first: first ?? 20, after },
    );
    const items = organization.projectV2.items;
    return json({
      items: items.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        content: n.content,
        fieldValues: n.fieldValues.nodes
          .filter((fv) => fv.field)
          .map((fv) => ({
            field: fv.field!.name,
            value: fv.text ?? fv.name ?? fv.date ?? fv.number,
          })),
      })),
      pageInfo: items.pageInfo,
    });
  },
});

/** Add an issue or pull request to a GitHub Project v2. */
export const create_project_item = tool({
  description: `Add an existing issue or pull request to a GitHub Project v2. Requires the project's node ID (from list_org_projects or get_project) and the issue/PR's node ID. Returns the new project item's ID.`,
  inputSchema: z.object({
    project_id: z.string().describe("Project node ID (from list_org_projects or get_project)"),
    content_id: z.string().describe("Node ID of the issue or pull request to add"),
  }),
  execute: async ({ project_id, content_id }) => {
    const { addProjectV2ItemById } = await octokit.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(
      `mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }`,
      { projectId: project_id, contentId: content_id },
    );
    return json({ item_id: addProjectV2ItemById.item.id });
  },
});

/** Update a field value on a project item. */
export const update_project_item = tool({
  description: `Update a field value on a project item in a GitHub Project v2. Use get_project to find field IDs. Value must match the field type: text, number, date (ISO 8601), or singleSelectOptionId.`,
  inputSchema: z.object({
    project_id: z.string().describe("Project node ID"),
    item_id: z.string().describe("Project item node ID"),
    field_id: z.string().describe("Field node ID"),
    value: z
      .union([
        z.object({ text: z.string() }),
        z.object({ number: z.number() }),
        z.object({ date: z.string() }),
        z.object({ singleSelectOptionId: z.string() }),
      ])
      .describe("Field value to set"),
  }),
  execute: async ({ project_id, item_id, field_id, value }) => {
    await octokit.graphql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
          projectV2Item { id }
        }
      }`,
      { projectId: project_id, itemId: item_id, fieldId: field_id, value },
    );
    return json({ updated: true, item_id });
  },
});

/** Remove an item from a GitHub Project v2. */
export const delete_project_item = tool({
  description: `Remove an item from a GitHub Project v2. This only removes it from the project board -- it does not delete the underlying issue or pull request.`,
  inputSchema: z.object({
    project_id: z.string().describe("Project node ID"),
    item_id: z.string().describe("Project item node ID to remove"),
  }),
  execute: async ({ project_id, item_id }) => {
    await octokit.graphql(
      `mutation($projectId: ID!, $itemId: ID!) {
        deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
          deletedItemId
        }
      }`,
      { projectId: project_id, itemId: item_id },
    );
    return json({ deleted: true, item_id });
  },
});
