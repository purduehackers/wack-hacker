import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullNumber, repoField } from "../../constants.ts";

export const close_pull_request = defineTool({
  description:
    "Close a pull request without merging. Does not delete the branch. Use update_pull_request with state='open' to reopen.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
  }),
  execute: async ({ repo, pull_number }) => {
    const { data } = await octokit().rest.pulls.update({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      state: "closed",
    });
    return JSON.stringify({ closed: true, number: data.number, html_url: data.html_url });
  },
});
