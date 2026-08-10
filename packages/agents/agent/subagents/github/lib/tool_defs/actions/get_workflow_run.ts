import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, runId } from "../../constants.ts";

export const get_workflow_run = defineTool({
  description: `Get detailed information about a specific workflow run, including its status, conclusion, triggering event, branch, commit SHA, and timing information.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    run_id: runId,
  }),
  execute: async ({ repo, run_id }) => {
    const { data } = await octokit().rest.actions.getWorkflowRun({
      owner: env.GITHUB_ORG,
      repo,
      run_id,
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      status: data.status,
      conclusion: data.conclusion,
      html_url: data.html_url,
      head_branch: data.head_branch,
      head_sha: data.head_sha?.slice(0, 7),
      event: data.event,
      created_at: data.created_at,
      updated_at: data.updated_at,
      run_attempt: data.run_attempt,
      run_started_at: data.run_started_at,
    });
  },
});
