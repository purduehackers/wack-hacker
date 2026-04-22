---
name: users
description: Admin-only management of CMS user accounts — invite, update roles, remove
criteria: Use when the user asks to grant, change, or revoke CMS access for a teammate (admin only)
tools: [list_users, get_user, create_user, update_user, delete_user]
minRole: admin
mode: inline
---

<roles>

- The CMS defines these roles: `admin`, `editor`, `viewer`, `hack_night_dashboard`, `events_website`, `wack_hacker`.
- Hierarchy is enforced server-side: `admin` implies `editor` implies `viewer`. The specialized roles (`hack_night_dashboard`, `events_website`, `wack_hacker`) are additive.
- `update_user({ roles: [...] })` REPLACES the role set — not a merge. Read the current roles with `get_user` first when adding/removing a single role.
  </roles>

<writes>

- `create_user` needs an email and an initial password (≥ 8 chars). The user can change it on first login.
- `delete_user` is approval-gated AND admin-gated. Prefer `update_user({ roles: ["viewer"] })` to strip editorial access instead — keeps audit trail + sessions table intact.
  </writes>

<visibility>

- This sub-skill is admin-only. Organizers cannot load it; they cannot see user-management tools in the menu.
  </visibility>
