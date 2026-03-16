---
name: channels
description: Create, edit, and delete channels and categories.
criteria: Use when the user wants to create, edit, move, rename, or delete a channel or category.
tools: create_channel, edit_channel, delete_channel
---

<creating>
- Determine the channel type: text, voice, category, announcement, forum, or stage.
- If placing under a category, use list_channels to find the category ID first.
- Channel names are automatically lowercased and spaces become hyphens.
- Only set optional fields if the user explicitly asked for them.
- Voice/stage channels support: bitrate, user_limit, rtc_region, video_quality_mode.
- Text/announcement channels support: topic, nsfw, slowmode, default_auto_archive_duration, default_thread_slowmode.

Common patterns:

- "Create a text channel" → create_channel with type "text"
- "Create a new category" → create_channel with type "category"
- "Create a voice channel in Events" → list_channels to find Events category, create_channel with parent_id
- "Create a voice channel with 128kbps" → create_channel with type "voice" and bitrate 128000
  </creating>

<editing>
- Use edit_channel to modify name, topic, category, NSFW flag, slowmode, position, and more.
- Voice/stage channels can also edit: bitrate, user_limit, rtc_region, video_quality_mode.
- Text channels can also edit: default_auto_archive_duration, default_thread_slowmode.
- To move a channel to a different category, set parent_id to the new category's ID.
- To remove a channel from its category, set parent_id to null.
- Only modify the fields the user asked to change.
</editing>

<deleting>
- Always confirm with the user before deleting. Channel deletion is irreversible.
- Deleting a category does NOT delete its child channels — they become uncategorized.
- Report the channel name in confirmation, never just the ID.
</deleting>
