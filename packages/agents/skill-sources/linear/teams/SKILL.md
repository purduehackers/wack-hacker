---
name: teams
description: List team members and manage team membership.
criteria: Use when the user wants to see who is on a team, add a user to a team, or remove a user from a team.
tools: [list_team_members, add_user_to_team, remove_user_from_team]
minRole: organizer
mode: inline
---

<listing>
- list_team_members returns all members of a team with name, email, role flags, and active status.
- Resolve team name to ID first via suggest_property_values if only a name is given.
</listing>

<managing>
Admin tools — only use when explicitly asked.

- add_user_to_team adds a workspace member to a team. Resolve both user and team IDs first.
- remove_user_from_team removes a user from a team. Always confirm identity and team before removing.
- Never act on ambiguous input — resolve the user and team first.
  </managing>
