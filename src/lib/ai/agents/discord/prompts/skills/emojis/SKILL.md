---
name: emojis
description: Manage custom emojis and stickers — list, create, edit, and delete.
criteria: Use when the user wants to manage custom emojis or stickers — listing, creating from images, editing, or deleting them.
tools: list_emojis, create_emoji, edit_emoji, delete_emoji, list_stickers, create_sticker, edit_sticker, delete_sticker
---

<emojis>
<listing>
- list_emojis returns all custom emojis with name, ID, animated flag, image URL, and role restrictions.
</listing>

<creating>
- Provide a name and an image URL. Accepted formats: PNG, JPG, GIF (GIF for animated). Max 256KB.
- Emoji names must be 2-32 characters, alphanumeric and underscores only.
- Optionally restrict usage to specific roles by providing role IDs.
- Servers have emoji slots based on boost level. If creation fails due to limits, let the user know.

Common patterns:

- "Add an emoji called pepe from this URL" → create_emoji with name and url
- "Create an emoji only usable by Admins" → list_roles to find Admin role ID, create_emoji with roles
  </creating>

<editing>
- edit_emoji can change the emoji name or its role restrictions.
- Pass an empty roles array to remove all role restrictions (makes it available to everyone).
</editing>

<deleting>
- Always confirm before deleting. Emoji deletion is irreversible.
- Report the emoji name in confirmation.
</deleting>
</emojis>

<stickers>
<listing>
- list_stickers returns all custom stickers with name, description, tags, format, and URL.
</listing>

<creating>
- Provide a name, a tag (autocomplete suggestion — typically a related emoji name like "wave"), and an image URL.
- Accepted formats: PNG, APNG, or Lottie JSON. Max 512KB, 320x320 pixels recommended.
- Description is optional but recommended.
- Servers have sticker slots based on boost level.

Common patterns:

- "Add a sticker called wave from this image" → create_sticker with name, tags ("wave"), and url
  </creating>

<editing>
- edit_sticker can change the sticker name, description, or autocomplete tag.
- Set description to null to clear it.
</editing>

<deleting>
- Always confirm before deleting. Sticker deletion is irreversible.
- Report the sticker name in confirmation.
</deleting>
</stickers>
