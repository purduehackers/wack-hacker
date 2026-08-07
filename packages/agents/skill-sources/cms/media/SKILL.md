---
name: media
description: List, fetch, upload, and delete image/file assets in the CMS media library
criteria: Use when the user asks to upload a photo to the CMS, audit the media library, or delete a media asset
tools: [list_media, get_media, upload_media, delete_media]
minRole: organizer
mode: inline
---

<uploads>

- `upload_media({ url, alt })` fetches the URL server-side and posts it to Payload. The `alt` text is required (accessibility).
- Optional fields: `filename` (derived from URL if omitted), `source` (`"manual"` default, `"hack-night"` for bot-driven batch uploads), `batch_id` (groups a batch of hack-night uploads), `discord_message_id` / `discord_user_id` (provenance for hack-night auto-uploads).
- The response includes the new `id` — keep it around if you're about to reference the asset from a ugrant / shelter-project / hack-night-session.
  </uploads>

<listing>

- `list_media` supports filtering by `source` and `batch_id`. Use `batch_id` to surface a specific hack-night upload batch for cleanup.
- Returned fields are camelCase → snake_case: `thumbnail_url`, `mime_type`, `discord_message_id`, etc.
  </listing>

<destructive>

- `delete_media` is approval-gated. Deletion is permanent and any page/post referencing the asset loses its image until relinked.
  </destructive>
