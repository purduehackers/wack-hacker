---
name: organization
description: "View organization members and teams; manage team membership and webhooks."
criteria: Use when the user wants to view org members, teams, manage team membership, or manage webhooks.
tools: list_org_members, get_org_member, list_teams, get_team, list_team_members, invite_org_member, remove_org_member, add_team_member, remove_team_member, list_repo_webhooks, create_webhook, update_webhook, delete_webhook, list_org_webhooks
---

<members>
- `list_org_members` shows all organization members with optional role filter ("admin", "member", "all").
- `get_org_member` returns a specific user's membership details (role, state).
</members>

<teams>
- `list_teams` shows all teams in the organization.
- `get_team` returns details for a team by its slug (e.g., "engineering").
- `list_team_members` shows members of a specific team with optional role filter.
- Teams are identified by slug, not name.
</teams>

<webhooks>
- `list_repo_webhooks` and `list_org_webhooks` show configured webhooks.
- `create_webhook` creates a new webhook for a repository.
  - Always specify events to subscribe to (e.g., ["push", "pull_request"]).
  - Use `content_type: "json"` unless the user specifies otherwise.
  - Include a `secret` for signature verification when possible.
- `update_webhook` modifies an existing webhook's URL, events, or active status.
- `delete_webhook` requires approval — deleting a webhook can break integrations.
</webhooks>
