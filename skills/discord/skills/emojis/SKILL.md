---
name: emojis
description: Manage custom emojis and stickers — list, create, edit, and delete.
criteria: Use when the user wants to manage custom emojis or stickers.
tools:
  [
    list_emojis,
    create_emoji,
    edit_emoji,
    delete_emoji,
    list_stickers,
    create_sticker,
    edit_sticker,
    delete_sticker,
  ]
minRole: organizer
mode: inline
---

<emojis>
- create_emoji requires a name and image URL. Formats: PNG, JPG, GIF. Max 256KB.
- Names must be 2-32 characters, alphanumeric and underscores only.
- Can restrict usage to specific roles.
- edit_emoji can change name or role restrictions.
- Always confirm before deleting.
</emojis>

<stickers>
- create_sticker requires name, tag (autocomplete suggestion), and image URL.
- Formats: PNG, APNG, or Lottie JSON. Max 512KB, 320x320px recommended.
- edit_sticker can change name, description, or tag.
- Always confirm before deleting.
</stickers>
