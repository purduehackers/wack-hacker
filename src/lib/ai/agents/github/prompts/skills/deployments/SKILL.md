---
name: deployments
description: Manage deployments, deployment statuses, and GitHub Pages.
criteria: Use when the user wants to view or create deployments, check deployment status, or manage GitHub Pages.
tools: list_deployments, create_deployment, create_deployment_status, get_pages_info, list_pages_builds, trigger_pages_build
---

<deployments>
- `list_deployments` can filter by environment and ref.
- `create_deployment` creates a new deployment. Requires approval since it can trigger production changes.
- Common environments: "production", "staging", "preview".
- After creating a deployment, update its status with `create_deployment_status`.
</deployments>

<deployment_statuses>

- States: "pending", "queued", "in_progress", "success", "failure", "error", "inactive".
- Include `environment_url` when the deployment has a publicly accessible URL.
- Include `log_url` when build logs are available.
  </deployment_statuses>

<pages>
- `get_pages_info` shows GitHub Pages configuration (source, URL, HTTPS enforcement).
- `list_pages_builds` shows build history.
- `trigger_pages_build` requests a new build.
- If Pages is not enabled, `get_pages_info` returns a clear message.
</pages>
