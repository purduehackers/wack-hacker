---
name: actions
description: List and manage workflows, workflow runs, jobs, and artifacts.
criteria: Use when the user wants to check CI/CD status, trigger workflows, view build logs, or manage workflow runs.
tools: list_workflows, list_workflow_runs, get_workflow_run, trigger_workflow, cancel_workflow_run, rerun_workflow, list_workflow_jobs, download_artifact
---

<workflows>
- `list_workflows` shows all workflow definitions in a repo.
- Workflows are identified by ID or filename (e.g., "ci.yml").
</workflows>

<runs>
- `list_workflow_runs` can filter by workflow, branch, and status.
- Common status values: "completed", "in_progress", "queued", "failure", "success".
- `get_workflow_run` shows full details for a specific run.
- To check "CI status", list recent workflow runs for the relevant branch.
</runs>

<triggering>
- `trigger_workflow` dispatches a workflow_dispatch event. Requires approval.
- The workflow must have `on: workflow_dispatch` in its YAML definition.
- Specify `ref` (branch/tag) and optional `inputs` matching the workflow's defined inputs.
</triggering>

<managing>
- `cancel_workflow_run` cancels an in-progress run.
- `rerun_workflow` re-runs a completed run.
</managing>

<jobs>
- `list_workflow_jobs` shows individual jobs within a run, including step-level status.
- Useful for diagnosing which step failed.
</jobs>

<artifacts>
- `download_artifact` returns a download URL for a workflow artifact.
- Artifacts are zip files.
</artifacts>
