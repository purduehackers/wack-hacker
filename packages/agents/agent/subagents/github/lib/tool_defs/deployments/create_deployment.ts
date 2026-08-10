import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const create_deployment = defineTool({
  description: `Create a new deployment for a repository. Specify the ref (branch/tag/SHA) to deploy and optionally the target environment. Returns the deployment ID and details, or a message if required status checks haven't passed.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().describe("Branch, tag, or SHA to deploy"),
    environment: z.string().exactOptional().describe("Environment (e.g. 'production', 'staging')"),
    description: z.string().exactOptional(),
    auto_merge: z.boolean().exactOptional(),
    required_contexts: z.array(z.string()).exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.createDeployment({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
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
