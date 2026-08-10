import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import {
  paginationInputShape,
  repoField,
  repoPaginatedInputShape,
  resourceId,
} from "./constants.ts";

/** Workflows are addressable by their numeric id or by their file name. */
const workflowRef = z.union([resourceId, z.string().min(1)]);
const runId = resourceId.describe("Workflow run ID");

/** List workflow definitions in a repository. */
export const list_workflows = defineTool({
  description: `List CI/CD workflows defined in a repository's .github/workflows directory. Returns each workflow's ID, name, file path, state, and URL.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.actions.listRepoWorkflows({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      workflows: data.workflows.map((w) => ({
        id: w.id,
        name: w.name,
        path: w.path,
        state: w.state,
        html_url: w.html_url,
      })),
    });
  },
});

/** List workflow runs for a repository or specific workflow. */
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

/** Get details for a specific workflow run. */
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

/** Trigger a workflow dispatch event to manually run a workflow. */
export const trigger_workflow = defineTool({
  description: `Trigger a workflow_dispatch event to manually run a workflow. The workflow must have a workflow_dispatch trigger defined. Specify the branch/tag to run on and optional input parameters.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    workflow_id: workflowRef.describe("Workflow ID or filename (e.g. 'deploy.yml')"),
    ref: z.string().describe("Branch or tag to run the workflow on"),
    inputs: z.record(z.string(), z.string()).exactOptional().describe("Workflow input parameters"),
  }),
  execute: async ({ repo, ...fields }) => {
    await octokit().rest.actions.createWorkflowDispatch({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ triggered: true, workflow_id: fields.workflow_id, ref: fields.ref });
  },
});

/** Cancel a workflow run that is in progress. */
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

/** Re-run a completed workflow run. */
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

/** List jobs for a workflow run with their steps and statuses. */
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

/** Get the download URL for a workflow artifact. */
export const download_artifact = defineTool({
  description: `Get the download URL for a workflow artifact by its ID. Returns a URL that can be used to download the artifact as a zip file.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    artifact_id: resourceId.describe("Artifact ID"),
  }),
  execute: async ({ repo, artifact_id }) => {
    const { url } = await octokit().rest.actions.downloadArtifact({
      owner: env.GITHUB_ORG,
      repo,
      artifact_id,
      archive_format: "zip",
    });
    return JSON.stringify({ download_url: url });
  },
});
