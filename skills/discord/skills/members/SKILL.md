---
name: members
description: View detailed member info and manage nicknames.
criteria: Use when the user wants to see detailed member information or change a member's nickname.
tools: [get_member, set_nickname]
minRole: organizer
mode: inline
---

<viewing>
- get_member returns full details: username, display name, nickname, roles, join date, boost status, and avatar.
- Use search_members first to resolve a name to a member ID.
- When presenting member info, use their display name and list roles by name.
</viewing>

<nicknames>
- set_nickname changes a member's server-specific display name.
- Pass null to clear a nickname (reverts to global display name).
- The bot cannot change the server owner's nickname.
- Nicknames are limited to 32 characters.
</nicknames>
