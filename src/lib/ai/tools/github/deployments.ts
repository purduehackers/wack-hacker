import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { octokit } from "./client.ts";

/** List deployments for a repository. */
export const list_deployments = tool({
  description: `List deployments for a repository. Optionally filter by environment name or ref (branch/tag/SHA). Returns deployment ID, ref, environment, description, creator, and timestamps.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    environment: z.string().optional().describe("Filter by environment"),
    ref: z.string().optional().describe("Filter by ref"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, environment, ref, per_page, page }) => {
    const { data } = await octokit.rest.repos.listDeployments({
      owner: env.GITHUB_ORG,
      repo,
      environment,
      ref,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((d) => ({
        id: d.id,
        ref: d.ref,
        environment: d.environment,
        description: d.description,
        creator: d.creator?.login,
        created_at: d.created_at,
        updated_at: d.updated_at,
      })),
    );
  },
});

/** Create a new deployment for a repository. */
export const create_deployment = tool({
  description: `Create a new deployment for a repository. Specify the ref (branch/tag/SHA) to deploy and optionally the target environment. Returns the deployment ID and details, or a message if required status checks haven't passed.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    ref: z.string().describe("Branch, tag, or SHA to deploy"),
    environment: z.string().optional().describe("Environment (e.g. 'production', 'staging')"),
    description: z.string().optional(),
    auto_merge: z.boolean().optional(),
    required_contexts: z.array(z.string()).optional(),
  }),
  execute: async ({ repo, ...input }) => {
    const { data } = await octokit.rest.repos.createDeployment({
      owner: env.GITHUB_ORG,
      repo,
      ...input,
    });
    if ("id" in data) {
      return JSON.stringify({
        id: data.id,
        ref: data.ref,
        environment: data.environment,
        created_at: data.created_at,
      });
    }
    return JSON.stringify({ message: data.message });
  },
});

/** Create a status update for an existing deployment. */
export const create_deployment_status = tool({
  description: `Create a status update for an existing deployment. Set the state (success, failure, in_progress, etc.) and optionally provide the deployed environment URL and log URL.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    deployment_id: z.number().describe("Deployment ID"),
    state: z
      .enum(["error", "failure", "inactive", "in_progress", "queued", "pending", "success"])
      .describe("Deployment state"),
    description: z.string().optional(),
    environment_url: z.string().optional().describe("URL of the deployed environment"),
    log_url: z.string().optional(),
  }),
  execute: async ({ repo, deployment_id, ...input }) => {
    const { data } = await octokit.rest.repos.createDeploymentStatus({
      owner: env.GITHUB_ORG,
      repo,
      deployment_id,
      ...input,
    });
    return JSON.stringify({
      id: data.id,
      state: data.state,
      environment_url: data.environment_url,
    });
  },
});

/** Get GitHub Pages configuration for a repository. */
export const get_pages_info = tool({
  description: `Get the GitHub Pages configuration for a repository, including the published URL, status, source branch/path, and HTTPS enforcement. Returns a message if Pages is not enabled.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
  }),
  execute: async ({ repo }) => {
    try {
      const { data } = await octokit.rest.repos.getPages({
        owner: env.GITHUB_ORG,
        repo,
      });
      return JSON.stringify({
        url: data.url,
        html_url: data.html_url,
        status: data.status,
        source: data.source,
        https_enforced: data.https_enforced,
      });
    } catch (e: any) {
      if (e.status === 404)
        return JSON.stringify({
          enabled: false,
          message: "GitHub Pages is not enabled for this repository",
        });
      throw e;
    }
  },
});

/** List GitHub Pages builds for a repository. */
export const list_pages_builds = tool({
  description: `List GitHub Pages builds for a repository. Returns each build's status, error info, timestamps, and duration. Useful for debugging Pages deployment issues.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit.rest.repos.listPagesBuilds({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 10,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((b) => ({
        status: b.status,
        error: b.error,
        created_at: b.created_at,
        updated_at: b.updated_at,
        duration: b.duration,
      })),
    );
  },
});

/** Request a GitHub Pages build. */
// destructive
export const trigger_pages_build = tool({
  description: `Manually trigger a GitHub Pages build for a repository. Returns the build status and URL. Only works for repos with Pages enabled.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
  }),
  execute: async ({ repo }) => {
    const { data } = await octokit.rest.repos.requestPagesBuild({
      owner: env.GITHUB_ORG,
      repo,
    });
    return JSON.stringify({ status: data.status, url: data.url });
  },
});
