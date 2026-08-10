import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { branchName, env, repoField } from "../../constants.ts";

/**
 * Value the branch-protection request body carries to clear a rule. GitHub
 * treats an explicit `null` as "remove this rule" and a missing key as "leave
 * it alone", so the literal is part of the wire contract. One named sentinel
 * keeps the rest of this file under the no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- GitHub clears a protection rule only when the request body sends an explicit null
const CLEAR_RULE = null;

export const set_branch_protection = defineTool({
  description: `Set or update branch protection rules — status checks, admin enforcement, review requirements, and push restrictions. Pass null to clear a rule.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    branch: branchName,
    required_status_checks: z
      .strictObject({
        strict: z.boolean(),
        contexts: z.array(z.string()),
      })
      .nullable()
      .optional(),
    enforce_admins: z.boolean().nullable().optional(),
    required_pull_request_reviews: z
      .strictObject({
        required_approving_review_count: z.int().min(0).max(6).exactOptional(),
        dismiss_stale_reviews: z.boolean().exactOptional(),
        require_code_owner_reviews: z.boolean().exactOptional(),
      })
      .nullable()
      .optional(),
    restrictions: z
      .strictObject({
        users: z.array(z.string()),
        teams: z.array(z.string()),
      })
      .nullable()
      .optional(),
  }),
  execute: async ({ repo, branch, ...rules }) => {
    await octokit().rest.repos.updateBranchProtection({
      owner: env.GITHUB_ORG,
      repo,
      branch,
      required_status_checks: rules.required_status_checks ?? CLEAR_RULE,
      enforce_admins: rules.enforce_admins ?? CLEAR_RULE,
      required_pull_request_reviews: rules.required_pull_request_reviews ?? CLEAR_RULE,
      restrictions: rules.restrictions ?? CLEAR_RULE,
    });
    return JSON.stringify({ updated: true, repo, branch });
  },
});
