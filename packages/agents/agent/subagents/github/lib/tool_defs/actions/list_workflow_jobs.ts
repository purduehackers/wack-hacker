import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape, repoField, runId } from "../../constants.ts";

export const list_workflow_jobs = defineTool({
  description: `List jobs for a workflow run. Returns each job's ID, name, status, conclusion, timing, and individual step details. Use 'latest' filter for the most recent attempt or 'all' for every attempt.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    run_id: runId,
    filter: z.enum(["latest", "all"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ repo, run_id, filter, per_page, page }) => {
    const { data } = await octokit().rest.actions.listJobsForWorkflowRun({
      owner: env.GITHUB_ORG,
      repo,
      run_id,
      filter: filter ?? "latest",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      jobs: data.jobs.map((j) => ({
        id: j.id,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        started_at: j.started_at,
        completed_at: j.completed_at,
        html_url: j.html_url,
        steps: j.steps?.map((s) => ({
          name: s.name,
          status: s.status,
          conclusion: s.conclusion,
          number: s.number,
        })),
      })),
    });
  },
});
