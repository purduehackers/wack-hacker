---
name: team-admin
description: Team members, access groups, webhooks, project routes, connect networks, microfrontends, billing, custom environments.
criteria: Use when the user asks about team membership, access groups, team webhooks, project routes, Vercel Connect private networks, microfrontend groups, billing charges, or custom preview environments.
tools:
  [
    get_team,
    list_team_members,
    remove_team_member,
    delete_team_invite_code,
    list_access_groups,
    get_access_group,
    delete_access_group,
    list_access_group_members,
    list_webhooks,
    get_webhook,
    delete_webhook,
    list_project_routes,
    list_project_route_versions,
    list_connect_networks,
    get_connect_network,
    delete_connect_network,
    list_microfrontend_groups,
    list_billing_charges,
    list_contract_commitments,
    list_custom_environments,
    get_custom_environment,
    remove_custom_environment,
  ]
minRole: organizer
mode: inline
---

<members>
- `remove_team_member` requires the user id. Use `list_team_members` to resolve names to ids.
- Team creation/invite/role-change tools are deliberately not exposed — they have complex request bodies that don't translate well from LLM inputs.
</members>

<access-groups>
- Groups bundle project roles. Deleting a group revokes its members' access to all attached projects.
</access-groups>

<webhooks>
- Deleting a webhook stops delivery. Any downstream consumer breaks.
</webhooks>

<routes>
- Read-only from this subagent. Route writes require a Routing Middleware deploy anyway.
</routes>

<billing>
- `list_billing_charges` requires `from` and `to` ISO 8601 UTC date-time strings.
- `list_contract_commitments` is team-scoped, no date required.
</billing>

<custom-environments>
- Custom environments are per-project branch-bound preview contexts.
- `remove_custom_environment` can also delete unassigned env vars if `deleteUnassignedEnvironmentVariables: true` — be deliberate.
</custom-environments>
