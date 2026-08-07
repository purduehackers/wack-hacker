---
name: organization
description: View organization members and teams; manage team membership and webhooks.
criteria: Use when the user wants to view org members, teams, manage membership, or manage webhooks.
tools:
  [
    list_org_members,
    get_org_member,
    list_teams,
    get_team,
    list_team_members,
    invite_org_member,
    remove_org_member,
    add_team_member,
    remove_team_member,
    list_repo_webhooks,
    create_webhook,
    update_webhook,
    delete_webhook,
    list_org_webhooks,
  ]
minRole: organizer
mode: inline
---

<members>
- list_org_members with optional role filter ("admin", "member", "all").
- get_org_member returns membership details.
</members>

<teams>
- Teams are identified by slug, not name.
- list_team_members with optional role filter.
</teams>

<webhooks>
- Always specify events to subscribe to (e.g., ["push", "pull_request"]).
- Use content_type: "json" unless specified otherwise.
- Include a secret for signature verification when possible.
- Deleting a webhook requires approval.
</webhooks>
