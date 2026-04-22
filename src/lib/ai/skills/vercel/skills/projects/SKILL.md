---
name: projects
description: Inspect and mutate Vercel projects — lifecycle, env vars (value-stripped on list), project domains, members.
criteria: Use when the user asks about a Vercel project's configuration, env vars, attached domains, members, pausing/unpausing, or deleting a project.
tools:
  [
    list_projects,
    get_project,
    delete_project,
    pause_project,
    unpause_project,
    create_project_transfer_request,
    list_project_env_vars,
    get_project_env_var,
    create_project_env_vars,
    edit_project_env_var,
    remove_project_env_var,
    list_project_domains,
    get_project_domain,
    remove_project_domain,
    verify_project_domain,
    list_promote_aliases,
    list_project_members,
    remove_project_member,
  ]
minRole: organizer
mode: inline
---

<env-vars>
- `list_project_env_vars` ALWAYS strips `value`. Never surface raw env var values unless the user explicitly asks, and even then use `get_project_env_var` which returns a single decrypted value.
- Env var writes (create/edit/remove) require a restart of the affected deployment to take effect.
- Scope is `production`, `preview`, or `development`. Most variables use all three.
</env-vars>

<domains>
- `verify_project_domain` re-runs the verification challenge; it doesn't change config.
- `remove_project_domain` detaches from the project but doesn't delete the domain registration.
</domains>

<writes>
- `delete_project` is irreversible — confirm the project id/name twice.
- `pause_project` blocks active production deployments; `unpause_project` reverses.
- `create_project_transfer_request` returns a 24-hour `code` for the accepting team.
</writes>
