---
name: comments
description: Post, edit, and delete comments on issues.
criteria: Use when the user explicitly asks to comment on, reply to, or annotate an issue.
tools: [create_comment, edit_comment, delete_comment]
minRole: organizer
mode: inline
---

<posting>
- Only use comment tools when the user explicitly asks to comment.
- Keep the comment body aligned to what the user asked.
- Search for the target issue first via search_entities.
</posting>

<editing_deleting>

- Editing/deleting typically only works for comments created earlier in this thread.
- Only delete when explicitly asked.
  </editing_deleting>

<formatting>
- Markdown supported: **bold**, _italic_, `code`, lists, code blocks.
</formatting>
