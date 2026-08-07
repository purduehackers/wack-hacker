import { z } from "zod";

import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { paginationInputShape } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

/** List deployments for a repository. */
export const list_deployments = defineTool({
  name: "list_deployments",
  domain: "github",
  description: `List deployments for a repository. Optionally filter by environment name or ref (branch/tag/SHA). Returns deployment ID, ref, environment, description, creator, and timestamps.`,
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    environment: z.string().optional().describe("Filter by environment"),
    ref: z.string().optional().describe("Filter by ref"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, environment, ref, per_page, page }) => {
    const { data } = await octokit().rest.repos.listDeployments({
      owner: env.GITHUB_ORG,
      repo,
      ...(environment === undefined ? {} : { environment }),
      ...(ref === undefined ? {} : { ref }),
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
export const create_deployment = defineTool({
  name: "create_deployment",
  domain: "github",
  description: `Create a new deployment for a repository. Specify the ref (branch/tag/SHA) to deploy and optionally the target environment. Returns the deployment ID and details, or a message if required status checks haven't passed.`,
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    ref: z.string().describe("Branch, tag, or SHA to deploy"),
    environment: z.string().optional().describe("Environment (e.g. 'production', 'staging')"),
    description: z.string().optional(),
    auto_merge: z.boolean().optional(),
    required_contexts: z.array(z.string()).optional(),
  }),
  execute: async ({ repo, ref, environment, description, auto_merge, required_contexts }) => {
    const { data } = await octokit().rest.repos.createDeployment({
      owner: env.GITHUB_ORG,
      repo,
      ref,
      ...(environment === undefined ? {} : { environment }),
      ...(description === undefined ? {} : { description }),
      ...(auto_merge === undefined ? {} : { auto_merge }),
      ...(required_contexts === undefined ? {} : { required_contexts }),
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
export const create_deployment_status = defineTool({
  name: "create_deployment_status",
  domain: "github",
  description: `Create a status update for an existing deployment. Set the state (success, failure, in_progress, etc.) and optionally provide the deployed environment URL and log URL.`,
  access: { risk: "write" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    deployment_id: z.number().describe("Deployment ID"),
    state: z
      .enum(["error", "failure", "inactive", "in_progress", "queued", "pending", "success"])
      .describe("Deployment state"),
    description: z.string().optional(),
    environment_url: z.string().optional().describe("URL of the deployed environment"),
    log_url: z.string().optional(),
  }),
  execute: async ({ repo, deployment_id, state, description, environment_url, log_url }) => {
    const { data } = await octokit().rest.repos.createDeploymentStatus({
      owner: env.GITHUB_ORG,
      repo,
      deployment_id,
      state,
      ...(description === undefined ? {} : { description }),
      ...(environment_url === undefined ? {} : { environment_url }),
      ...(log_url === undefined ? {} : { log_url }),
    });
    return JSON.stringify({
      id: data.id,
      state: data.state,
      environment_url: data.environment_url,
    });
  },
});

/** Get GitHub Pages configuration for a repository. */
export const get_pages_info = defineTool({
  name: "get_pages_info",
  domain: "github",
  description: `Get the GitHub Pages configuration for a repository, including the published URL, status, source branch/path, and HTTPS enforcement. Returns a message if Pages is not enabled.`,
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
  }),
  execute: async ({ repo }) => {
    try {
      const { data } = await octokit().rest.repos.getPages({
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
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "status" in e && e.status === 404)
        return JSON.stringify({
          enabled: false,
          message: "GitHub Pages is not enabled for this repository",
        });
      throw e;
    }
  },
});

/** List GitHub Pages builds for a repository. */
export const list_pages_builds = defineTool({
  name: "list_pages_builds",
  domain: "github",
  description: `List GitHub Pages builds for a repository. Returns each build's status, error info, timestamps, and duration. Useful for debugging Pages deployment issues.`,
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.listPagesBuilds({
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
export const trigger_pages_build = defineTool({
  name: "trigger_pages_build",
  domain: "github",
  description: `Manually trigger a GitHub Pages build for a repository. Returns the build status and URL. Only works for repos with Pages enabled.`,
  access: { risk: "destructive" },
  input: z.object({
    repo: z.string().describe("Repository name"),
  }),
  execute: async ({ repo }) => {
    const { data } = await octokit().rest.repos.requestPagesBuild({
      owner: env.GITHUB_ORG,
      repo,
    });
    return JSON.stringify({ status: data.status, url: data.url });
  },
});
