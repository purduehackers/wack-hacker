import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, secretName } from "../../constants.ts";

export const delete_repo_secret = defineTool({
  description: `Delete an Actions secret from a repository.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    secret_name: secretName,
  }),
  execute: async ({ repo, secret_name }) => {
    await octokit().rest.actions.deleteRepoSecret({
      owner: env.GITHUB_ORG,
      repo,
      secret_name,
    });
    return JSON.stringify({ deleted: true, secret_name });
  },
});
