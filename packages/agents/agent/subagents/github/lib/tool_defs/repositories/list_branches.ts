import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape, repoField } from "../../constants.ts";

export const list_branches = defineTool({
  description: `List branches for a repository. Optionally filter to only protected branches. Returns branch name and protection status.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    protected: z.boolean().exactOptional().describe("Filter to protected branches only"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page, ...filters }) => {
    const { data } = await octokit().rest.repos.listBranches({
      owner: env.GITHUB_ORG,
      repo,
      ...filters,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(data.map((b) => ({ name: b.name, protected: b.protected })));
  },
});
