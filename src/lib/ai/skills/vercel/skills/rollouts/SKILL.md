---
name: rollouts
description: Rolling releases (canary rollouts) and deployment checks.
criteria: Use when the user asks about rolling releases, gradual deployments, approving release stages, or deployment checks (pre-deploy CI-style gates).
tools:
  [
    get_rolling_release,
    get_rolling_release_config,
    get_rolling_release_billing_status,
    delete_rolling_release_config,
    approve_rolling_release_stage,
    complete_rolling_release,
    list_project_checks,
    get_project_check,
    delete_project_check,
    list_check_runs,
    list_deployment_check_runs,
    get_deployment_check_run,
  ]
minRole: organizer
mode: inline
---

<rolling-releases>
- `get_rolling_release_billing_status` checks whether the project's plan supports rolling releases (feature is plan-gated).
- `approve_rolling_release_stage` requires `canaryDeploymentId` and `nextStageIndex`. Shifts live production traffic.
- `complete_rolling_release` routes 100% of traffic to the canary deployment immediately.
- `delete_rolling_release_config` removes the rolling release setup; future deploys ship to 100% on first release.
</rolling-releases>

<checks>
- Check runs gate deployments. Use `list_project_checks` to see configured checks; `list_deployment_check_runs` to see runs on a specific deployment.
- Creating new checks isn't exposed here (the SDK types for `CreateProjectCheckRequestBody` require a complex source config). Direct the user to the Vercel dashboard.
</checks>
