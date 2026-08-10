import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const archive_repository = defineTool({
  description:
    "Archive a repository — makes it read-only. Reversible via update_repository archived=false, but users can no longer push, open issues/PRs, or fork while archived.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
  }),
  execute: async ({ repo }) => {
    const { data } = await octokit().rest.repos.update({
      owner: env.GITHUB_ORG,
      repo,
      archived: true,
    });
    return JSON.stringify({
      archived: true,
      repo: data.full_name,
    });
  },
});
