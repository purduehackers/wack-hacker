import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const create_deployment_status = defineTool({
  description: `Create a status update for an existing deployment. Set the state (success, failure, in_progress, etc.) and optionally provide the deployed environment URL and log URL.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    deployment_id: resourceId.describe("Deployment ID"),
    state: z
      .enum(["error", "failure", "inactive", "in_progress", "queued", "pending", "success"])
      .describe("Deployment state"),
    description: z.string().exactOptional(),
    environment_url: z
      .url({ protocol: /^https?$/u })
      .exactOptional()
      .describe("URL of the deployed environment"),
    log_url: z.url({ protocol: /^https?$/u }).exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.createDeploymentStatus({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      state: data.state,
      environment_url: data.environment_url,
    });
  },
});
