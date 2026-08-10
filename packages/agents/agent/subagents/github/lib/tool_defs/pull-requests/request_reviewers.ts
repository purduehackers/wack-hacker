import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullNumber, repoField } from "../../constants.ts";

export const request_reviewers = defineTool({
  description: "Request reviewers on a pull request. Can request individual users and/or teams.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    reviewers: z
      .array(z.string())
      .exactOptional()
      .describe("GitHub usernames to request as reviewers"),
    team_reviewers: z
      .array(z.string())
      .exactOptional()
      .describe("Team slugs to request as reviewers"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.requestReviewers({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      requested_reviewers: data.requested_reviewers?.map((r) => r.login),
      requested_teams: data.requested_teams?.map((t) => t.slug),
    });
  },
});
