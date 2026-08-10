import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullNumber, repoField } from "../../constants.ts";

export const create_pr_review = defineTool({
  description: `Submit a review on a pull request. Can APPROVE, REQUEST_CHANGES, or leave a COMMENT. Include a body with your review feedback.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    body: z.string().exactOptional().describe("Review body"),
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review action"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.createReview({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      state: data.state,
      html_url: data.html_url,
    });
  },
});
