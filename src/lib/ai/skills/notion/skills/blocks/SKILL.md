---
name: blocks
description: Read and modify individual Notion blocks — retrieve, update, archive, list children, and append.
criteria: Use when the user wants fine-grained block manipulation on a Notion page (individual paragraphs, toggles, callouts) rather than replacing whole-page content.
tools: [retrieve_block, update_block, delete_block, list_block_children, append_block_children]
minRole: organizer
mode: inline
---

- Block types: paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, to_do, toggle, callout, quote, code, divider, image, bookmark, equation, table, table_row, column, column_list, synced_block, template, child_page, child_database.
- update_block payload must match the existing block's type (keyed by block type).
- delete_block archives — Notion has no hard-delete for blocks.
- append_block_children takes plain block objects (e.g. `{ paragraph: { rich_text: [{ text: { content: '...' } }] } }`).
- For page-level markdown edits, prefer update_page_content in the pages skill — it's faster for bulk changes.
