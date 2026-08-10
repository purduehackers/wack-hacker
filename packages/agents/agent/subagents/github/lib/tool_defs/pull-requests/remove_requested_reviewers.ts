import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullNumber, repoField } from "../../constants.ts";

export const remove_requested_reviewers = defineTool({
  description: "Remove previously-requested reviewers from a pull request.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    reviewers: z.array(z.string()).describe("GitHub usernames to remove"),
    team_reviewers: z.array(z.string()).optional().describe("Team slugs to remove"),
  }),
  execute: async ({ repo, pull_number, reviewers, team_reviewers }) => {
    const { data } = await octokit().rest.pulls.removeRequestedReviewers({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      reviewers,
      team_reviewers: team_reviewers ?? [],
    });
    return JSON.stringify({
      number: data.number,
      requested_reviewers: data.requested_reviewers?.map((r) => r.login),
    });
  },
});
