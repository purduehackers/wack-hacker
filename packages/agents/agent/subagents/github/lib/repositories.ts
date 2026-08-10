import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit, octokitStatus } from "./client.ts";
import { env } from "./config.ts";
import { paginationInputShape, repoField, repoName, resourceId } from "./constants.ts";

/**
 * Value the branch-protection request body carries to clear a rule. GitHub
 * treats an explicit `null` as "remove this rule" and a missing key as "leave
 * it alone", so the literal is part of the wire contract. One named sentinel
 * keeps the rest of this module under the no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- GitHub clears a protection rule only when the request body sends an explicit null
const CLEAR_RULE = null;

const branchName = z.string().min(1).describe("Branch name");

export const create_repository = defineTool({
  description: `Create a new repository in the purduehackers organization. Returns the repo name, URL, visibility, and default branch.`,
  access: { risk: "write" },
  input: z.strictObject({
    name: repoName.describe("Repository name"),
    description: z.string().exactOptional(),
    private: z.boolean().default(true).describe("Whether the repo is private (default true)"),
    auto_init: z.boolean().exactOptional().describe("Initialize with a README"),
    gitignore_template: z.string().exactOptional().describe("Gitignore template (e.g. 'Node')"),
    license_template: z.string().exactOptional().describe("License template (e.g. 'mit')"),
  }),
  execute: async (input) => {
    const { data } = await octokit().rest.repos.createInOrg({
      org: env.GITHUB_ORG,
      ...input,
    });
    return JSON.stringify({
      name: data.name,
      full_name: data.full_name,
      html_url: data.html_url,
      private: data.private,
      default_branch: data.default_branch,
    });
  },
});

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

export const delete_repository = defineTool({
  description: `Permanently delete a repository. Irreversible — destroys all code, issues, and history.`,
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    repo: repoName.describe("Repository name to delete"),
  }),
  execute: async ({ repo }) => {
    await octokit().rest.repos.delete({ owner: env.GITHUB_ORG, repo });
    return JSON.stringify({ deleted: true, repo: `${env.GITHUB_ORG}/${repo}` });
  },
});

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

export const transfer_repository = defineTool({
  description:
    "Transfer a repository to a different owner (user or org). The new owner receives a transfer invitation which they must accept.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    new_owner: z.string().min(1).describe("New owner's username or org slug"),
    team_ids: z.array(resourceId).exactOptional().describe("Team IDs to add on transfer"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.transfer({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      transferring: true,
      new_full_name: `${fields.new_owner}/${repo}`,
      html_url: data.html_url,
    });
  },
});

export const list_branches = defineTool({
  description: `List branches for a repository. Optionally filter to only protected branches. Returns branch name and protection status.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    protected: z.boolean().exactOptional().describe("Filter to protected branches only"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page, ...filters }) => {
    const { data } = await octokit().rest.repos.listBranches({
      owner: env.GITHUB_ORG,
      repo,
      ...filters,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(data.map((b) => ({ name: b.name, protected: b.protected })));
  },
});

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

export const delete_branch_protection = defineTool({
  description: `Remove all branch protection rules from a branch, making it unprotected.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    branch: branchName,
  }),
  execute: async ({ repo, branch }) => {
    await octokit().rest.repos.deleteBranchProtection({
      owner: env.GITHUB_ORG,
      repo,
      branch,
    });
    return JSON.stringify({ deleted: true, repo, branch });
  },
});
