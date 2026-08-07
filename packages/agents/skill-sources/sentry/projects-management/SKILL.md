---
name: projects-management
description: Create, update, and delete Sentry projects; manage project environments and client keys (DSNs).
criteria: Use when the user wants to create/delete a Sentry project, update project settings, or manage DSNs/environments.
tools:
  [
    create_project,
    update_project,
    delete_project,
    list_project_environments,
    list_project_keys,
    create_project_key,
    delete_project_key,
  ]
minRole: admin
mode: inline
---

- create_project requires a team_slug owner and a platform (e.g. 'javascript-nextjs').
- update_project resolve_age: hours after which unhandled issues auto-resolve (0 to disable).
- delete_project is irreversible — removes all issues, events, and config.
- Client keys (DSNs) are what SDKs use to ingest events. delete_project_key breaks all clients using that DSN.
- Environments are auto-created when events come in with an environment tag; list_project_environments shows what's seen so far.
