---
name: membership
description: Invite new members to the Linear workspace or remove existing ones (admin only).
criteria: Use when the user wants to add a new member to the Linear workspace or remove an existing member.
tools: [add_member_to_platform, remove_member_from_platform]
minRole: admin
mode: inline
---

<adding>
- add_member_to_platform sends a Linear invite by email. Role defaults to 'member'; use 'admin' or 'guest' only when explicitly asked.
- Never guess or fabricate an email address — always confirm the exact address with the user.
- Returns the invite id, email, role, and expiresAt. Invite expires if not accepted.
</adding>

<removing>
- remove_member_from_platform handles two cases:
  - If the user has not accepted their invite yet: pass `email` to revoke the pending invite.
  - If the user has joined the workspace: pass `user_id` to suspend them (data is preserved).
- Always confirm identity before calling — resolve the email or user_id explicitly.
- Suspension, not deletion — all their data (issues, comments, projects) stays in Linear.
</removing>
