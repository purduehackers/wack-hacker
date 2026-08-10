import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, releaseId, repoField } from "../../constants.ts";

export const delete_release = defineTool({
  description: "Delete a release by ID. The associated tag is not deleted automatically.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    release_id: releaseId,
  }),
  execute: async ({ repo, release_id }) => {
    await octokit().rest.repos.deleteRelease({
      owner: env.GITHUB_ORG,
      repo,
      release_id,
    });
    return JSON.stringify({ deleted: true, release_id });
  },
});
