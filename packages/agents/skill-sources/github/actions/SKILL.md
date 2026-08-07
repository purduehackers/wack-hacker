---
name: actions
description: List and manage workflows, workflow runs, jobs, and artifacts.
criteria: Use when the user wants to check CI/CD status, trigger workflows, view build logs, or manage runs.
tools:
  [
    list_workflows,
    list_workflow_runs,
    get_workflow_run,
    trigger_workflow,
    cancel_workflow_run,
    rerun_workflow,
    list_workflow_jobs,
    download_artifact,
  ]
minRole: organizer
mode: inline
---

<workflows>
- list_workflows shows all definitions. Identified by ID or filename (e.g., "ci.yml").
</workflows>

<runs>
- list_workflow_runs can filter by workflow, branch, and status.
- Status values: "completed", "in_progress", "queued", "failure", "success".
</runs>

<triggering>
- trigger_workflow dispatches a workflow_dispatch event. Requires approval.
- Workflow must have `on: workflow_dispatch` in its YAML.
- Specify ref (branch/tag) and optional inputs.
</triggering>

<jobs>
- list_workflow_jobs shows individual jobs within a run, including step-level status.
</jobs>

<artifacts>
- download_artifact returns a download URL. Artifacts are zip files.
</artifacts>
