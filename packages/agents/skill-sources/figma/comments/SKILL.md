---
name: comments
description: List, create, and delete comments and reactions on files.
criteria: Use when the user wants to view, post, or delete comments on a Figma file, or add reactions.
tools: [list_comments, create_comment, delete_comment, add_reaction, delete_reaction]
minRole: organizer
mode: inline
---

<listing>
- list_comments returns all comments on a file with text, author, timestamp, and resolved status.
- Comments can be pinned to specific locations (x, y coordinates) or nodes.
- Threaded replies have a parent comment ID.
</listing>

<creating>
- Specify file_key and message text.
- Optionally pin to a position with x/y coordinates, or to a specific node_id.
- For replies, include the parent comment_id.
- Only post comments when the user explicitly asks.
</creating>

<reactions>
- add_reaction/delete_reaction target a specific comment by ID.
- Emoji is specified as a shortcode (e.g., ":thumbsup:", ":heart:").
</reactions>
