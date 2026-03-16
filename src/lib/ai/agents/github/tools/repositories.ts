import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../../env.ts";
import { octokit } from "../client";

export const create_repository = tool({
  description: `Create a new repository in the purduehackers organization. Returns the repo name, URL, visibility, and default branch.`,
  inputSchema: z.object({
    name: z.string().describe("Repository name"),
    description: z.string().optional(),
    private: z
      .boolean()
      .optional()
      .describe("Whether the repo is private (default true)"),
    auto_init: z.boolean().optional().describe("Initialize with a README"),
    gitignore_template: z
      .string()
      .optional()
      .describe("Gitignore template (e.g. 'Node')"),
    license_template: z
      .string()
      .optional()
      .describe("License template (e.g. 'mit')"),
  }),
  execute: async (input) => {
    const { data } = await octokit.rest.repos.createInOrg({
      org: env.GITHUB_ORG,
      name: input.name,
      description: input.description,
      private: input.private ?? true,
      auto_init: input.auto_init,
      gitignore_template: input.gitignore_template,
      license_template: input.license_template,
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

export const update_repository = tool({
  description: `Update repository settings — description, visibility, archive status, default branch, and merge strategies.`,
  inputSchema: z.object({
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
  execute: async ({ repo, ...settings }) => {
    const { data } = await octokit.rest.repos.update({
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

export const delete_repository = tool({
  description: `Permanently delete a repository. Irreversible — destroys all code, issues, and history.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name to delete"),
  }),
  execute: async ({ repo }) => {
    await octokit.rest.repos.delete({ owner: env.GITHUB_ORG, repo });
    return JSON.stringify({ deleted: true, repo: `${env.GITHUB_ORG}/${repo}` });
  },
});

export const list_branches = tool({
  description: `List branches for a repository. Optionally filter to only protected branches. Returns branch name and protection status.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    protected: z
      .boolean()
      .optional()
      .describe("Filter to protected branches only"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, ...opts }) => {
    const { data } = await octokit.rest.repos.listBranches({
      owner: env.GITHUB_ORG,
      repo,
      protected: opts.protected,
      per_page: opts.per_page ?? 30,
      page: opts.page ?? 1,
    });
    return JSON.stringify(
      data.map((b) => ({ name: b.name, protected: b.protected })),
    );
  },
});

export const get_branch_protection = tool({
  description: `Get branch protection rules — required status checks, review requirements, admin enforcement, and push restrictions. Returns 'not protected' if no rules are set.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("Branch name"),
  }),
  execute: async ({ repo, branch }) => {
    try {
      const { data } = await octokit.rest.repos.getBranchProtection({
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
                data.required_pull_request_reviews
                  .required_approving_review_count,
              dismiss_stale_reviews:
                data.required_pull_request_reviews.dismiss_stale_reviews,
              require_code_owner_reviews:
                data.required_pull_request_reviews.require_code_owner_reviews,
            }
          : null,
        restrictions: data.restrictions,
      });
    } catch (e: any) {
      if (e.status === 404)
        return JSON.stringify({
          protected: false,
          message: "No protection rules set",
        });
      throw e;
    }
  },
});

export const set_branch_protection = tool({
  description: `Set or update branch protection rules — status checks, admin enforcement, review requirements, and push restrictions. Pass null to clear a rule.`,
  inputSchema: z.object({
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
    await octokit.rest.repos.updateBranchProtection({
      owner: env.GITHUB_ORG,
      repo,
      branch,
      required_status_checks: rules.required_status_checks ?? null,
      enforce_admins: rules.enforce_admins ?? null,
      required_pull_request_reviews:
        rules.required_pull_request_reviews ?? null,
      restrictions: rules.restrictions ?? null,
    });
    return JSON.stringify({ updated: true, repo, branch });
  },
});

export const delete_branch_protection = tool({
  description: `Remove all branch protection rules from a branch, making it unprotected.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("Branch name"),
  }),
  execute: async ({ repo, branch }) => {
    await octokit.rest.repos.deleteBranchProtection({
      owner: env.GITHUB_ORG,
      repo,
      branch,
    });
    return JSON.stringify({ deleted: true, repo, branch });
  },
});
