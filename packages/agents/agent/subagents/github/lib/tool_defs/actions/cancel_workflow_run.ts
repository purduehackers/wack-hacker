import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, runId } from "../../constants.ts";

export const cancel_workflow_run = defineTool({
  description: `Cancel a workflow run that is currently in progress or queued. Returns confirmation of cancellation.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    run_id: runId,
  }),
  execute: async ({ repo, run_id }) => {
    await octokit().rest.actions.cancelWorkflowRun({
      owner: env.GITHUB_ORG,
      repo,
      run_id,
    });
    return JSON.stringify({ cancelled: true, run_id });
  },
});
