import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const update_repository = defineTool({
  description: `Update repository settings — description, visibility, archive status, default branch, and merge strategies.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    description: z.string().exactOptional(),
    private: z.boolean().exactOptional(),
    archived: z.boolean().exactOptional(),
    default_branch: z.string().min(1).exactOptional(),
    has_issues: z.boolean().exactOptional(),
    has_wiki: z.boolean().exactOptional(),
    has_projects: z.boolean().exactOptional(),
    allow_squash_merge: z.boolean().exactOptional(),
    allow_merge_commit: z.boolean().exactOptional(),
    allow_rebase_merge: z.boolean().exactOptional(),
    delete_branch_on_merge: z.boolean().exactOptional(),
  }),
  execute: async ({ repo, ...settings }) => {
    const { data } = await octokit().rest.repos.update({
      owner: env.GITHUB_ORG,
      repo,
      ...settings,
    });
    return JSON.stringify({
      name: data.name,
      html_url: data.html_url,
      private: data.private,
      archived: data.archived,
      default_branch: data.default_branch,
    });
  },
});
