import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullNumber, repoField } from "../../constants.ts";

export const merge_pull_request = defineTool({
  description: `Merge a pull request. Supports merge commit, squash, and rebase strategies. Optionally set a custom commit title and message. Returns whether the merge succeeded and the resulting SHA.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    commit_title: z.string().exactOptional().describe("Merge commit title"),
    commit_message: z.string().exactOptional().describe("Merge commit body"),
    merge_method: z.enum(["merge", "squash", "rebase"]).exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.merge({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      merged: data.merged,
      sha: data.sha,
      message: data.message,
    });
  },
});
