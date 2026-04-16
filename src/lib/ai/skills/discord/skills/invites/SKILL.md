---
name: invites
description: List, create, and delete server invites.
criteria: Use when the user wants to manage server invites — listing active invites, creating new ones, or revoking existing ones.
tools: [list_invites, create_invite, delete_invite]
minRole: admin
mode: inline
---

<listing>
- list_invites returns all active server invites with codes, channels, creators, usage stats, and expiry.
- Present invites in a table: code, channel, creator, uses/max, expires.
</listing>

<creating>
- create_invite requires a channel ID — ask which channel if not specified.
- Default: 24h expiry, unlimited uses, non-temporary.
- Set max_uses for one-time invites. Set max_age to 0 for permanent invites.
- temporary invites auto-kick members who don't get a role before disconnecting.
- Always return the full URL (discord.gg/CODE) so it can be shared immediately.
</creating>

<deleting>
- delete_invite revokes an invite by code. Use list_invites first to find available codes.
- Always confirm before revoking — this is irreversible.
</deleting>
