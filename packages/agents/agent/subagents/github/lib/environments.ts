import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { repoField, repoPaginatedInputShape, resourceId } from "./constants.ts";

const environmentName = z.string().min(1).describe("Environment name");

export const list_environments = defineTool({
  description:
    "List deployment environments for a repository. Returns name, URL, protection rules, and timestamps.",
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
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
  description: "Get details for a single deployment environment, including protection rules.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    environment_name: environmentName,
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
  description:
    "Create or update a deployment environment. Optionally configure wait timers and required reviewers (by user IDs or team IDs).",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    environment_name: environmentName,
    wait_timer: z
      .int()
      .min(0)
      .max(43_200)
      .exactOptional()
      .describe("Wait minutes before allowing deploys"),
    reviewers: z
      .array(
        z.strictObject({
          type: z.enum(["User", "Team"]),
          id: resourceId,
        }),
      )
      .exactOptional()
      .describe("Required reviewers before deploy"),
    deployment_branch_policy: z
      .strictObject({
        protected_branches: z.boolean(),
        custom_branch_policies: z.boolean(),
      })
      .nullable()
      .exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.createOrUpdateEnvironment({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      html_url: data.html_url,
    });
  },
});

export const delete_environment = defineTool({
  description: "Delete a deployment environment. Associated deployments become unenvironmented.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    environment_name: environmentName,
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
