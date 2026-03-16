---
name: comments
description: Create and list comments on pages and blocks.
criteria: Use when the user wants to comment on a page, read existing comments, or reply in a discussion thread.
tools: create_comment, list_comments
---

<creating>
- Use create_comment to add a comment to a page or reply in a discussion thread.
- For new comments on a page: use parent_type "page_id" with the page's ID.
- For replies to existing comments: use parent_type "discussion_id" with the discussion thread ID (from list_comments results).
- Pass comment content as a plain text string via the `text` parameter.
- Only comment when the user explicitly asks. Normal chat replies don't require Notion comments.
- Search for the target page first via search_notion if the user references it by name.
</creating>

<listing>
- Use list_comments to read comments on a page or block. Pass the page/block ID as block_id.
- Results include the comment text, author, timestamp, and discussion_id for threading.
- Results are paginated. Use start_cursor for more.
</listing>
