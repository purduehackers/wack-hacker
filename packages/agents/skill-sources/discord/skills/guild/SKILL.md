---
name: guild
description: View and update server-level settings (admin only for updates).
criteria: Use when the user wants to change the server name, icon, banner, verification level, or other server-level settings; or view the public preview/vanity URL.
tools: [update_guild, get_guild_preview, get_vanity_url]
minRole: admin
mode: inline
---

- update_guild changes server settings. Only send the fields the user asked to change.
- Icons/banners/splash accept data URIs (data:image/png;base64,...). Pass null to remove.
- verification_level: 0=none, 1=low (verified email), 2=medium (registered >5min), 3=high (on server >10min), 4=very_high (verified phone).
- get_guild_preview returns public-facing info (member count, description, features).
- get_vanity_url returns the custom invite if configured (e.g. discord.gg/purduehackers).
