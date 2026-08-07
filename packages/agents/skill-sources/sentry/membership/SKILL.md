---
name: membership
description: Invite new members to the Sentry organization or remove existing ones (admin only).
criteria: Use when the user wants to add a new member to the Sentry organization or remove an existing member.
tools: [add_member_to_platform, remove_member_from_platform]
minRole: admin
mode: inline
---

<adding>
- add_member_to_platform invites by email. Role defaults to 'member'; other roles include 'admin', 'manager', 'owner', 'billing'.
- Never fabricate an email — always confirm the exact address.
- Optionally assign to teams by slug via team_roles.
- Returns invite id, email, role, and pending status.
</adding>

<removing>
- remove_member_from_platform removes a member by their Sentry member ID (not email).
- Resolve the member ID via list_members first — never remove on ambiguous input.
- Confirm with the user before calling — this is destructive.
</removing>
