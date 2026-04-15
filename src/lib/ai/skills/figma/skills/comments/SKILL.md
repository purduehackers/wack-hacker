---
name: comments
description: Read and post comments on Figma files for design review.
criteria: Use when the user wants to read comments on a design, post feedback, or reply to a comment.
tools: [list_file_comments, post_file_comment]
minRole: organizer
mode: inline
---

<reading>
- `list_file_comments` returns all comments on a file (newest first).
- Each comment includes: text, author, timestamp, resolved status, and pinned node (if any).
- Comments with a `parent_id` are replies in a thread.
</reading>

<posting>
- Use `post_file_comment` to add a new comment to a file.
- Pin to a specific node with `node_id` for targeted feedback.
- Reply to a thread by providing `comment_id` (the parent comment's ID).
- Never post comments without explicit user intent.
</posting>
