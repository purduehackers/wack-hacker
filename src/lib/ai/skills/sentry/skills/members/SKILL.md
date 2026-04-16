---
name: members
description: List and manage organization members and teams; view team membership.
criteria: Use when the user wants to view org members, teams, manage team membership, or create/delete teams.
tools:
  [
    list_members,
    get_member,
    list_teams,
    get_team,
    list_team_members,
    create_team,
    update_team,
    delete_team,
    add_team_member,
    remove_team_member,
  ]
minRole: organizer
mode: inline
---

<members>
- list_members shows all org members with roles and team assignments.
- Members are identified by numeric member ID.
- Roles include: owner, manager, admin, member, billing.
- Pending members have been invited but haven't accepted yet.
</members>

<teams>
- Teams are identified by slug, not name.
- create_team auto-generates a slug from the name if not provided.
- delete_team is irreversible. Requires explicit user intent.
</teams>

<membership>
- add_team_member and remove_team_member require both member_id and team_slug.
- Use list_members to find member IDs before adding/removing.
</membership>
