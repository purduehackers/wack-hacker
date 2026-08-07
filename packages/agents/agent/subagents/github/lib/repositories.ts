import { z } from "zod";

import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { paginationInputShape } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

export const create_repository = defineTool({
  name: "create_repository",
  domain: "github",
  description: `Create a new repository in the purduehackers organization. Returns the repo name, URL, visibility, and default branch.`,
  access: { risk: "write" },
  input: z.object({
    name: z.string().describe("Repository name"),
    description: z.string().optional(),
    private: z.boolean().optional().describe("Whether the repo is private (default true)"),
    auto_init: z.boolean().optional().describe("Initialize with a README"),
    gitignore_template: z.string().optional().describe("Gitignore template (e.g. 'Node')"),
    license_template: z.string().optional().describe("License template (e.g. 'mit')"),
  }),
  execute: async (input) => {
    const { data } = await octokit().rest.repos.createInOrg({
      org: env.GITHUB_ORG,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      private: input.private ?? true,
      ...(input.auto_init === undefined ? {} : { auto_init: input.auto_init }),
      ...(input.gitignore_template === undefined
        ? {}
        : { gitignore_template: input.gitignore_template }),
      ...(input.license_template === undefined ? {} : { license_template: input.license_template }),
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
  name: "update_repository",
  domain: "github",
  description: `Update repository settings — description, visibility, archive status, default branch, and merge strategies.`,
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    description: z.string().optional(),
    private: z.boolean().optional(),
    archived: z.boolean().optional(),
    default_branch: z.string().optional(),
    has_issues: z.boolean().optional(),
    has_wiki: z.boolean().optional(),
    has_projects: z.boolean().optional(),
    allow_squash_merge: z.boolean().optional(),
    allow_merge_commit: z.boolean().optional(),
    allow_rebase_merge: z.boolean().optional(),
    delete_branch_on_merge: z.boolean().optional(),
  }),
  execute: async ({
    repo,
    description,
    private: isPrivate,
    archived,
    default_branch,
    has_issues,
    has_wiki,
    has_projects,
    allow_squash_merge,
    allow_merge_commit,
    allow_rebase_merge,
    delete_branch_on_merge,
  }) => {
    const { data } = await octokit().rest.repos.update({
      owner: env.GITHUB_ORG,
      repo,
      ...(description === undefined ? {} : { description }),
      ...(isPrivate === undefined ? {} : { private: isPrivate }),
      ...(archived === undefined ? {} : { archived }),
      ...(default_branch === undefined ? {} : { default_branch }),
      ...(has_issues === undefined ? {} : { has_issues }),
      ...(has_wiki === undefined ? {} : { has_wiki }),
      ...(has_projects === undefined ? {} : { has_projects }),
      ...(allow_squash_merge === undefined ? {} : { allow_squash_merge }),
      ...(allow_merge_commit === undefined ? {} : { allow_merge_commit }),
      ...(allow_rebase_merge === undefined ? {} : { allow_rebase_merge }),
      ...(delete_branch_on_merge === undefined ? {} : { delete_branch_on_merge }),
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
  name: "delete_repository",
  domain: "github",
  description: `Permanently delete a repository. Irreversible — destroys all code, issues, and history.`,
  access: { risk: "destructive", confirm: "second-party" },
  input: z.object({
    repo: z.string().describe("Repository name to delete"),
  }),
  execute: async ({ repo }) => {
    await octokit().rest.repos.delete({ owner: env.GITHUB_ORG, repo });
    return JSON.stringify({ deleted: true, repo: `${env.GITHUB_ORG}/${repo}` });
  },
});

export const archive_repository = defineTool({
  name: "archive_repository",
  domain: "github",
  description:
    "Archive a repository — makes it read-only. Reversible via update_repository archived=false, but users can no longer push, open issues/PRs, or fork while archived.",
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
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
  name: "transfer_repository",
  domain: "github",
  description:
    "Transfer a repository to a different owner (user or org). The new owner receives a transfer invitation which they must accept.",
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    new_owner: z.string().describe("New owner's username or org slug"),
    team_ids: z.array(z.number()).optional().describe("Team IDs to add on transfer"),
  }),
  execute: async ({ repo, new_owner, team_ids }) => {
    const { data } = await octokit().rest.repos.transfer({
      owner: env.GITHUB_ORG,
      repo,
      new_owner,
      ...(team_ids === undefined ? {} : { team_ids }),
    });
    return JSON.stringify({
      transferring: true,
      new_full_name: `${new_owner}/${repo}`,
      html_url: data.html_url,
    });
  },
});

export const list_branches = defineTool({
  name: "list_branches",
  domain: "github",
  description: `List branches for a repository. Optionally filter to only protected branches. Returns branch name and protection status.`,
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    protected: z.boolean().optional().describe("Filter to protected branches only"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, ...opts }) => {
    const { data } = await octokit().rest.repos.listBranches({
      owner: env.GITHUB_ORG,
      repo,
      ...(opts.protected === undefined ? {} : { protected: opts.protected }),
      per_page: opts.per_page ?? 30,
      page: opts.page ?? 1,
    });
    return JSON.stringify(data.map((b) => ({ name: b.name, protected: b.protected })));
  },
});

export const get_branch_protection = defineTool({
  name: "get_branch_protection",
  domain: "github",
  description: `Get branch protection rules — required status checks, review requirements, admin enforcement, and push restrictions. Returns 'not protected' if no rules are set.`,
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("Branch name"),
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
      if (typeof e === "object" && e !== null && "status" in e && e.status === 404)
        return JSON.stringify({
          protected: false,
          message: "No protection rules set",
        });
      throw e;
    }
  },
});

export const set_branch_protection = defineTool({
  name: "set_branch_protection",
  domain: "github",
  description: `Set or update branch protection rules — status checks, admin enforcement, review requirements, and push restrictions. Pass null to clear a rule.`,
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("Branch name"),
    required_status_checks: z
      .object({
        strict: z.boolean(),
        contexts: z.array(z.string()),
      })
      .nullable()
      .optional(),
    enforce_admins: z.boolean().nullable().optional(),
    required_pull_request_reviews: z
      .object({
        required_approving_review_count: z.number().optional(),
        dismiss_stale_reviews: z.boolean().optional(),
        require_code_owner_reviews: z.boolean().optional(),
      })
      .nullable()
      .optional(),
    restrictions: z
      .object({
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
      // oxlint-disable-next-line unicorn/no-null -- GitHub uses null to clear this rule
      required_status_checks: rules.required_status_checks ?? null,
      // oxlint-disable-next-line unicorn/no-null -- GitHub uses null to clear this rule
      enforce_admins: rules.enforce_admins ?? null,
      required_pull_request_reviews:
        // oxlint-disable-next-line unicorn/no-null -- nullable input clears this rule
        rules.required_pull_request_reviews == null
          ? // oxlint-disable-next-line unicorn/no-null -- GitHub uses null to clear this rule
            null
          : {
              ...(rules.required_pull_request_reviews.required_approving_review_count === undefined
                ? {}
                : {
                    required_approving_review_count:
                      rules.required_pull_request_reviews.required_approving_review_count,
                  }),
              ...(rules.required_pull_request_reviews.dismiss_stale_reviews === undefined
                ? {}
                : {
                    dismiss_stale_reviews:
                      rules.required_pull_request_reviews.dismiss_stale_reviews,
                  }),
              ...(rules.required_pull_request_reviews.require_code_owner_reviews === undefined
                ? {}
                : {
                    require_code_owner_reviews:
                      rules.required_pull_request_reviews.require_code_owner_reviews,
                  }),
            },
      // oxlint-disable-next-line unicorn/no-null -- GitHub uses null to clear this rule
      restrictions: rules.restrictions ?? null,
    });
    return JSON.stringify({ updated: true, repo, branch });
  },
});

export const delete_branch_protection = defineTool({
  name: "delete_branch_protection",
  domain: "github",
  description: `Remove all branch protection rules from a branch, making it unprotected.`,
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("Branch name"),
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
