import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { isoDateOrDateTime, resourceId } from "./constants.ts";

const pageInfoSchema = z.strictObject({
  hasNextPage: z.boolean(),
  endCursor: z.string(),
});

/** The fields every ProjectV2 selection asks for; the detail query adds to them. */
const projectSummaryShape = {
  id: z.string(),
  title: z.string(),
  number: z.int(),
  url: z.url(),
  closed: z.boolean(),
  shortDescription: z.string(),
};

const projectFieldSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  dataType: z.string(),
});

const listOrgProjectsResponseSchema = z.strictObject({
  organization: z.strictObject({
    projectsV2: z.strictObject({
      nodes: z.array(z.strictObject(projectSummaryShape)),
      pageInfo: pageInfoSchema,
    }),
  }),
});

const getProjectResponseSchema = z.strictObject({
  organization: z.strictObject({
    projectV2: z.strictObject({
      ...projectSummaryShape,
      readme: z.string(),
      fields: z.strictObject({ nodes: z.array(projectFieldSchema) }),
    }),
  }),
});

const listProjectItemsResponseSchema = z.strictObject({
  organization: z.strictObject({
    projectV2: z.strictObject({
      items: z.strictObject({
        nodes: z.array(
          z.strictObject({
            id: z.string(),
            type: z.string(),
            content: z
              .strictObject({
                __typename: z.string(),
                title: z.string().optional(),
                number: z.int().optional(),
                url: z.url().optional(),
              })
              .nullable(),
            fieldValues: z.strictObject({
              nodes: z.array(
                z.strictObject({
                  field: z.strictObject({ name: z.string() }).optional(),
                  text: z.string().optional(),
                  name: z.string().optional(),
                  date: z.string().optional(),
                  number: z.number().optional(),
                }),
              ),
            }),
          }),
        ),
        pageInfo: pageInfoSchema,
      }),
    }),
  }),
});

const createProjectItemResponseSchema = z.strictObject({
  addProjectV2ItemById: z.strictObject({ item: z.strictObject({ id: z.string() }) }),
});

/** Projects v2 is GraphQL-only, so every call decodes an untyped payload here. */
function decodeGraphql<S extends z.ZodType>(schema: S, payload: unknown): z.output<S> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamError({
      service: "GitHub",
      status: 502,
      detail: `invalid GraphQL response: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}

/** List GitHub Projects v2 in the organization. */
export const list_org_projects = defineTool({
  description: `List GitHub Projects v2 in the purduehackers organization. Returns each project's node ID, title, number, URL, closed status, and description. Supports cursor-based pagination.`,
  access: { risk: "read" },
  input: z.strictObject({
    first: z.int().min(1).max(50).optional().describe("Number of projects to fetch (max 50)"),
    after: z.string().optional().describe("Cursor for pagination"),
  }),
  execute: async ({ first, after }) => {
    const { organization } = decodeGraphql(
      listOrgProjectsResponseSchema,
      await octokit().graphql(
        `query($org: String!, $first: Int!, $after: String) {
      organization(login: $org) {
        projectsV2(first: $first, after: $after) {
          nodes { id title number url closed shortDescription }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
        { org: env.GITHUB_ORG, first: first ?? 20, after },
      ),
    );
    return JSON.stringify({
      projects: organization.projectsV2.nodes,
      pageInfo: organization.projectsV2.pageInfo,
    });
  },
});

/** Get details for a specific GitHub Project v2 by number. */
export const get_project = defineTool({
  description: `Get detailed information about a GitHub Project v2 by its number. Returns the project's node ID, title, URL, description, readme, and all field definitions (ID, name, data type). Use field IDs when updating project items.`,
  access: { risk: "read" },
  input: z.strictObject({
    project_number: resourceId.describe("Project number"),
  }),
  execute: async ({ project_number }) => {
    const { organization } = decodeGraphql(
      getProjectResponseSchema,
      await octokit().graphql(
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
        { org: env.GITHUB_ORG, number: project_number },
      ),
    );
    return JSON.stringify(organization.projectV2);
  },
});

/** List items in a GitHub Project v2. */
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

/** Add an issue or pull request to a GitHub Project v2. */
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

/** Update a field value on a project item. */
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

/** Remove an item from a GitHub Project v2. */
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
