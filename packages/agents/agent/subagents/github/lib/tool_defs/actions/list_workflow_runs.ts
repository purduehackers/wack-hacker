import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape, repoField, workflowRef } from "../../constants.ts";

export const list_workflow_runs = defineTool({
  description: `List workflow runs for a repository. Optionally filter by workflow ID/filename, branch, or status. Returns run ID, name, status, conclusion, branch, and timestamps. If no workflow_id is given, lists runs across all workflows.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    workflow_id: workflowRef.optional().describe("Workflow ID or filename"),
    branch: z.string().optional(),
    status: z
      .enum([
        "completed",
        "action_required",
        "cancelled",
        "failure",
        "neutral",
        "skipped",
        "stale",
        "success",
        "timed_out",
        "in_progress",
        "queued",
        "requested",
        "waiting",
        "pending",
      ])
      .optional(),
    ...paginationInputShape,
  }),
  execute: async ({ repo, workflow_id, branch, status, per_page, page }) => {
    if (workflow_id !== undefined) {
      const { data } = await octokit().rest.actions.listWorkflowRuns({
        owner: env.GITHUB_ORG,
        repo,
        workflow_id,
        branch,
        status: status,
        per_page: per_page ?? 10,
        page: page ?? 1,
      });
      return JSON.stringify({
        total_count: data.total_count,
        runs: data.workflow_runs.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          html_url: r.html_url,
          head_branch: r.head_branch,
          created_at: r.created_at,
          updated_at: r.updated_at,
          run_attempt: r.run_attempt,
        })),
      });
    }
    const { data } = await octokit().rest.actions.listWorkflowRunsForRepo({
      owner: env.GITHUB_ORG,
      repo,
      branch,
      status: status,
      per_page: per_page ?? 10,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      runs: data.workflow_runs.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        html_url: r.html_url,
        head_branch: r.head_branch,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    });
  },
});
