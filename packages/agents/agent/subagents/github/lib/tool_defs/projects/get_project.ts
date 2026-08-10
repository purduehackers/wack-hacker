import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, resourceId } from "../../constants.ts";
import { decodeGraphql, getProjectResponseSchema } from "../../projects-graphql.ts";

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
