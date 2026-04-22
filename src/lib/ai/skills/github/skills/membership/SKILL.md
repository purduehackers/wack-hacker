---
name: membership
description: Invite or remove members from the purduehackers GitHub organization (admin only).
criteria: Use when the user wants to add a new member to the GitHub organization or remove an existing member.
tools: [add_member_to_platform, remove_member_from_platform]
minRole: admin
mode: inline
---

<adding>
- add_member_to_platform invites a GitHub user by username. Role defaults to 'member'; use 'admin' only when explicitly asked.
- Confirm the exact GitHub username with the user — do not guess.
- If the user already exists in the org, the call updates their role instead.
- State returns as 'active' (already a member) or 'pending' (invite sent, awaiting acceptance).
</adding>

<removing>
- remove_member_from_platform revokes the user's organization membership and all repo access.
- Confirm with the user before calling — this is destructive and not reversible without reinviting.
- The user's GitHub account is not affected; only their org membership is removed.
</removing>
