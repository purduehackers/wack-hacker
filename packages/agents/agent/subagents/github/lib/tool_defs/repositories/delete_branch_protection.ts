import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { branchName, env, repoField } from "../../constants.ts";

export const delete_branch_protection = defineTool({
  description: `Remove all branch protection rules from a branch, making it unprotected.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    branch: branchName,
  }),
  execute: async ({ repo, branch }) => {
    await octokit().rest.repos.deleteBranchProtection({
      owner: env.GITHUB_ORG,
      repo,
      branch,
    });
    return JSON.stringify({ deleted: true, repo, branch });
  },
});
