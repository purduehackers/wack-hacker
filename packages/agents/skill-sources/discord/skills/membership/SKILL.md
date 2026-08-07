---
name: membership
description: Add or remove members from the Discord server (admin only).
criteria: Use when the user wants to add a new member to the Discord server or remove an existing member from the server.
tools: [add_member_to_platform, remove_member_from_platform]
minRole: admin
mode: inline
---

<adding>
- add_member_to_platform creates a single-use invite URL (Discord bot tokens cannot add users directly — that requires user-OAuth2 with guilds.join scope).
- Default expires in 24h, single-use. Override max_age_seconds / max_uses when the user asks.
- Always share the full URL (`https://discord.gg/CODE`) so the new member can join immediately.
- Requires a channel_id — pick a general/landing channel unless the user specifies one.
</adding>

<removing>
- remove_member_from_platform kicks a member. They keep their Discord account and can rejoin with a new invite.
- Resolve member_id via search_members before calling — never kick on ambiguous input.
- For permanent removal, suggest ban_member instead (which also prevents rejoining).
- Always confirm with the user before removing.
</removing>
