import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit, octokitStatus } from "../../client.ts";
import { branchName, env, repoField } from "../../constants.ts";

export const get_branch_protection = defineTool({
  description: `Get branch protection rules — required status checks, review requirements, admin enforcement, and push restrictions. Returns 'not protected' if no rules are set.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    branch: branchName,
  }),
  execute: async ({ repo, branch }) => {
    try {
      const { data } = await octokit().rest.repos.getBranchProtection({
        owner: env.GITHUB_ORG,
        repo,
        branch,
      });
      return JSON.stringify({
        required_status_checks: data.required_status_checks,
        enforce_admins: data.enforce_admins?.enabled,
        required_pull_request_reviews: data.required_pull_request_reviews
          ? {
              required_approving_review_count:
                data.required_pull_request_reviews.required_approving_review_count,
              dismiss_stale_reviews: data.required_pull_request_reviews.dismiss_stale_reviews,
              require_code_owner_reviews:
                data.required_pull_request_reviews.require_code_owner_reviews,
            }
          : // oxlint-disable-next-line unicorn/no-null -- preserve the upstream nullable response
            null,
        restrictions: data.restrictions,
      });
    } catch (e: unknown) {
      if (octokitStatus(e) === 404)
        return JSON.stringify({
          protected: false,
          message: "No protection rules set",
        });
      throw e;
    }
  },
});
