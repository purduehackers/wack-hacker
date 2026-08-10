import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, runId } from "../../constants.ts";

export const rerun_workflow = defineTool({
  description: `Re-run a completed workflow run. This creates a new attempt of the same run. Useful for retrying failed builds or deployments.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    run_id: runId,
  }),
  execute: async ({ repo, run_id }) => {
    await octokit().rest.actions.reRunWorkflow({
      owner: env.GITHUB_ORG,
      repo,
      run_id,
    });
    return JSON.stringify({ rerun: true, run_id });
  },
});
