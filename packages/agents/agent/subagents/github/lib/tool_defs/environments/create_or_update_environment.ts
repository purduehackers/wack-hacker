import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, environmentName, repoField, resourceId } from "../../constants.ts";

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
