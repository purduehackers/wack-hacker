---
name: member-management
description: Moderate members — ban, kick, timeout, and manage the ban list (admin only).
criteria: Use when the user wants to ban, unban, kick, timeout, or clear a timeout on a Discord member, or view the ban list.
tools: [ban_member, unban_member, list_bans, kick_member, timeout_member, clear_timeout]
minRole: admin
mode: inline
---

<banning>
- ban_member permanently blocks the user from rejoining (until unbanned).
- Optionally delete recent messages via delete_message_seconds (0-604800 = up to 7 days).
- unban_member removes the ban. Requires the user ID (from list_bans if you don't have it).
- list_bans returns banned users with reasons; paginate via before/after.
</banning>

<kicking>
- kick_member removes the member from the server. They can rejoin with a new invite.
- Use ban_member instead when you need to prevent rejoining.
</kicking>

<timeouts>
- timeout_member silences a member for up to 28 days. They cannot talk, react, or join voice.
- Duration is in seconds; pick reasonable durations (e.g. 600 = 10min, 3600 = 1h, 86400 = 1d).
- clear_timeout immediately restores talk permissions.
</timeouts>

Always confirm moderation actions with the user first. Always set a reason for the audit log.
