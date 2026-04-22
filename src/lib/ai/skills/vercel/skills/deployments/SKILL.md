---
name: deployments
description: Inspect and control deployments — list, view events, cancel, delete, promote, rollback.
criteria: Use when the user asks about specific deployments, build events, canceling an in-flight build, promoting/rolling back production, or investigating deployment files.
tools:
  [
    list_deployments,
    get_deployment,
    get_deployment_events,
    list_deployment_files,
    get_deployment_file_contents,
    cancel_deployment,
    delete_deployment,
    update_integration_deployment_action,
    promote_deployment,
    rollback_deployment,
    update_rollback_description,
  ]
minRole: organizer
mode: inline
---

<inspection>
- `get_deployment_events` accepts `idOrUrl` (deployment id or URL hostname) and caps `limit` at 200.
- `list_deployment_files` returns a tree; use `get_deployment_file_contents` to fetch a file (base64).
</inspection>

<traffic>
- `promote_deployment` and `rollback_deployment` are asynchronous — they return `{ ok: true, note: "..." }` immediately. Poll `list_promote_aliases` (projects sub-skill) to watch traffic shift.
- Rolling releases may override promote/rollback behaviour — check `get_rolling_release_config` first.
- Cancel only works on `BUILDING`/`QUEUED`/`INITIALIZING` deployments.
</traffic>

<deletion>
- `delete_deployment` is permanent and cannot target the active production deployment.
</deletion>
