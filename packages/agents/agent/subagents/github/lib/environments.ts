import { z } from "zod";

import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { paginationInputShape } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

export const list_environments = defineTool({
  name: "list_environments",
  domain: "github",
  description:
    "List deployment environments for a repository. Returns name, URL, protection rules, and timestamps.",
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.getAllEnvironments({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      environments: (data.environments ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        html_url: e.html_url,
        created_at: e.created_at,
        updated_at: e.updated_at,
        protection_rules: e.protection_rules,
      })),
    });
  },
});

export const get_environment = defineTool({
  name: "get_environment",
  domain: "github",
  description: "Get details for a single deployment environment, including protection rules.",
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    environment_name: z.string().describe("Environment name"),
  }),
  execute: async ({ repo, environment_name }) => {
    const { data } = await octokit().rest.repos.getEnvironment({
      owner: env.GITHUB_ORG,
      repo,
      environment_name,
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      html_url: data.html_url,
      created_at: data.created_at,
      updated_at: data.updated_at,
      protection_rules: data.protection_rules,
    });
  },
});

export const create_or_update_environment = defineTool({
  name: "create_or_update_environment",
  domain: "github",
  description:
    "Create or update a deployment environment. Optionally configure wait timers and required reviewers (by user IDs or team IDs).",
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    environment_name: z.string().describe("Environment name"),
    wait_timer: z.number().min(0).optional().describe("Wait minutes before allowing deploys"),
    reviewers: z
      .array(
        z.object({
          type: z.enum(["User", "Team"]),
          id: z.number(),
        }),
      )
      .optional()
      .describe("Required reviewers before deploy"),
    deployment_branch_policy: z
      .object({
        protected_branches: z.boolean(),
        custom_branch_policies: z.boolean(),
      })
      .nullable()
      .optional(),
  }),
  execute: async ({ repo, environment_name, wait_timer, reviewers, deployment_branch_policy }) => {
    const { data } = await octokit().rest.repos.createOrUpdateEnvironment({
      owner: env.GITHUB_ORG,
      repo,
      environment_name,
      ...(wait_timer === undefined ? {} : { wait_timer }),
      ...(reviewers === undefined ? {} : { reviewers }),
      ...(deployment_branch_policy === undefined ? {} : { deployment_branch_policy }),
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      html_url: data.html_url,
    });
  },
});

export const delete_environment = defineTool({
  name: "delete_environment",
  domain: "github",
  description: "Delete a deployment environment. Associated deployments become unenvironmented.",
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    environment_name: z.string().describe("Environment name"),
  }),
  execute: async ({ repo, environment_name }) => {
    await octokit().rest.repos.deleteAnEnvironment({
      owner: env.GITHUB_ORG,
      repo,
      environment_name,
    });
    return JSON.stringify({ deleted: true, environment_name });
  },
});
