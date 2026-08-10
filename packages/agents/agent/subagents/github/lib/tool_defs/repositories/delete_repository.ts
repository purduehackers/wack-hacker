import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoName } from "../../constants.ts";

export const delete_repository = defineTool({
  description: `Permanently delete a repository. Irreversible — destroys all code, issues, and history.`,
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    repo: repoName.describe("Repository name to delete"),
  }),
  execute: async ({ repo }) => {
    await octokit().rest.repos.delete({ owner: env.GITHUB_ORG, repo });
    return JSON.stringify({ deleted: true, repo: `${env.GITHUB_ORG}/${repo}` });
  },
});
