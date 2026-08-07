---
name: deployments
description: Manage deployments, deployment statuses, and GitHub Pages.
criteria: Use when the user wants to view or create deployments, check deployment status, or manage GitHub Pages.
tools:
  [
    list_deployments,
    create_deployment,
    create_deployment_status,
    get_pages_info,
    list_pages_builds,
    trigger_pages_build,
  ]
minRole: organizer
mode: inline
---

<deployments>
- list_deployments can filter by environment and ref.
- create_deployment requires approval since it can trigger production changes.
- Common environments: "production", "staging", "preview".
- After creating, update status with create_deployment_status.
</deployments>

<deployment_statuses>

- States: "pending", "queued", "in_progress", "success", "failure", "error", "inactive".
  </deployment_statuses>

<pages>
- get_pages_info shows Pages configuration. list_pages_builds shows build history.
- trigger_pages_build requests a new build.
</pages>
