import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape, repoField } from "../../constants.ts";

export const list_deployments = defineTool({
  description: `List deployments for a repository. Optionally filter by environment name or ref (branch/tag/SHA). Returns deployment ID, ref, environment, description, creator, and timestamps.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    environment: z.string().exactOptional().describe("Filter by environment"),
    ref: z.string().exactOptional().describe("Filter by ref"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page, ...filters }) => {
    const { data } = await octokit().rest.repos.listDeployments({
      owner: env.GITHUB_ORG,
      repo,
      ...filters,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((d) => ({
        id: d.id,
        ref: d.ref,
        environment: d.environment,
        description: d.description,
        creator: d.creator?.login,
        created_at: d.created_at,
        updated_at: d.updated_at,
      })),
    );
  },
});
