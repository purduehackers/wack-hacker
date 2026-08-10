import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env } from "../../constants.ts";
import { decodeGraphql, listOrgProjectsResponseSchema } from "../../projects-graphql.ts";

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
