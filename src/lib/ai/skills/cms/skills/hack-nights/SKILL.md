---
name: hack-nights
description: Create, update, and publish hack night session records on cms.purduehackers.com
criteria: Use when the user asks to record, edit, or publish a hack night session (title, date, host, description)
tools:
  [
    list_hack_night_sessions,
    get_hack_night_session,
    create_hack_night_session,
    update_hack_night_session,
    delete_hack_night_session,
    publish_hack_night_session,
    unpublish_hack_night_session,
  ]
minRole: organizer
mode: inline
---

<records>

- `hack-night-sessions` records hold title, date (ISO datetime), host `{ preferred_name, discord_id }`, description (richText), and a published flag.
- Host is a group field — always pass both `host_preferred_name` and `host_discord_id` on create, or neither on update.
- `publish_hack_night_session` / `unpublish_hack_night_session` flip `published`. They are NOT approval-gated — confirm with the user before flipping because it affects the hack night dashboard.
  </records>

<images>

- Image uploads go through the `media` sub-skill. Upload via `upload_media({ url, alt, source: 'hack-night', batch_id })` first, then (if needed) pass references into the hack night session via the admin UI or `update_hack_night_session`. In v1, image attachment via the agent is best-effort — the admin UI is canonical.
  </images>
