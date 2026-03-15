---
name: users
description: List, inspect, and manage workspace users — profiles, teams, workload, invites, and (admin-only) suspend/unsuspend.
criteria: Use when the user wants to look up a person, see who's on a team, check someone's workload, invite someone, or manage user accounts.
tools: list_users, get_user, get_user_teams, get_user_assigned_issues, suspend_user, unsuspend_user, invite_user, list_invites, delete_invite
---

<lookup>
- `list_users` returns all workspace members with name, email, role flags, and active status.
- `get_user` returns a single user's full profile including timezone, status, and issue count.
- `get_user_teams` shows which teams a user belongs to — use for "what teams is X on?".
- `get_user_assigned_issues` shows their open issues with priority and state — use for "what's X working on?" or "show my issues".
- When looking up a person by name, use `suggest_property_values` (field: "Issue.assigneeId", query: name) first — it's faster than listing all users. Fall back to `list_users` and filter if no match.
- When resolving "me" / "my" / "assign to me", use `user.nickname` from execution context as the search query. Try full nickname, then first name only.
</lookup>

<admin>
All tools in this section require workspace admin privileges. Only use when explicitly asked.

Suspending and restoring:

- `suspend_user` disables a user's access. Their data (issues, comments, history) is preserved, but they can no longer log in or receive notifications.
- `unsuspend_user` restores access for a previously suspended user.
- Always confirm the user's identity (resolve by name → show profile) before suspending. Never suspend based on ambiguous input.

Inviting:

- `invite_user` sends an email invite. Requires the invitee's email address — never guess or fabricate an email.
- Role defaults to "member". Can also invite as "admin" or "guest".
- Guest users have limited access — they can only see teams they're explicitly added to.
- `list_invites` shows all pending (not yet accepted) invites with email, role, who sent it, and when it expires.
- `delete_invite` revokes a pending invite by ID. Use `list_invites` first to find the ID.
  </admin>
