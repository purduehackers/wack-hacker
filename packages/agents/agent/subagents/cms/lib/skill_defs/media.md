---
description: List, fetch, upload, and delete image/file assets in the CMS media library
---

## When to use

Use when the user asks to upload a photo to the CMS, audit the media library, or delete a media asset

## Relevant tools

`list_media`, `get_media`, `upload_media`, `delete_media`

## Instructions

<uploads>

- `upload_media({ url, alt })` fetches the URL server-side and posts it to Payload. The `alt` text is required (accessibility).
- Optional fields: `filename` (derived from URL if omitted), `source` (`"manual"` default, `"hack-night"` and `"discord-drop"` for bot-driven batch uploads), `batch_id` (groups one drop's uploads — a date slug for hack night, the event slug for an `/image-drop`), `discord_message_id` / `discord_user_id` (provenance for those auto-uploads).
- The response includes the new `id` — keep it around if you're about to reference the asset from a ugrant / shelter-project / hack-night-session.
  </uploads>

<listing>

- `list_media` supports filtering by `source` and `batch_id`. Use `batch_id` to surface a specific bot upload batch for cleanup or to bulk-attach it to an event.
- Returned fields are camelCase → snake_case: `thumbnail_url`, `mime_type`, `discord_message_id`, etc.
  </listing>

<destructive>

- `delete_media` is approval-gated. Deletion is permanent and any page/post referencing the asset loses its image until relinked.
  </destructive>
