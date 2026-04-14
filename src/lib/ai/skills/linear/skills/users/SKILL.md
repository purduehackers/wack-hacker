---
name: users
description: List, inspect, and manage workspace users — profiles, teams, workload, invites.
criteria: Use when the user wants to look up a person, see who's on a team, check workload, invite someone, or manage accounts.
tools:
  [
    list_users,
    get_user,
    get_user_teams,
    get_user_assigned_issues,
    suspend_user,
    unsuspend_user,
    invite_user,
    list_invites,
    delete_invite,
  ]
minRole: organizer
mode: inline
---

<lookup>
- list_users returns all workspace members.
- get_user returns a single user's full profile.
- get_user_teams shows which teams a user belongs to.
- get_user_assigned_issues shows their open issues.
- When resolving "me", use user.nickname from execution context via suggest_property_values.
</lookup>

<admin>
Admin tools require workspace admin privileges. Only use when explicitly asked.

- suspend_user disables access. Data is preserved. Always confirm identity first.
- unsuspend_user restores access.
- invite_user sends an email invite. Never guess or fabricate an email.
- Role defaults to "member". Can invite as "admin" or "guest".
- list_invites shows pending invites. delete_invite revokes a pending invite.
  </admin>
