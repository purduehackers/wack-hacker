---
name: pages
description: Create, update, read, and edit pages — properties and Notion-flavored markdown content.
criteria: Use when the user wants to create a new page, update page properties, read or edit page content.
tools:
  [
    create_page,
    update_page,
    archive_page,
    retrieve_page_property,
    read_page_content,
    update_page_content,
    retrieve_user,
    retrieve_bot_user,
  ]
minRole: organizer
mode: inline
---

<creating>
- Determine the parent: database (entry/row) or page (subpage).
- For database parents: always retrieve_database first for the property schema.
- For page parents: search_notion to find the parent page by name.
- Body content via the `markdown` parameter — write as Notion-flavored markdown.
- Only set properties the user explicitly asked for.

Property value formats:

- title: `{ "title": [{ "text": { "content": "text" } }] }`
- rich_text: `{ "rich_text": [{ "text": { "content": "text" } }] }`
- number: `{ "number": 42 }`
- select: `{ "select": { "name": "Option" } }`
- multi_select: `{ "multi_select": [{ "name": "Tag1" }] }`
- status: `{ "status": { "name": "In Progress" } }`
- date: `{ "date": { "start": "2024-01-15" } }`
- checkbox: `{ "checkbox": true }`
- url: `{ "url": "https://..." }`
- people: `{ "people": [{ "id": "user-uuid" }] }` (resolve via list_users)
- relation: `{ "relation": [{ "id": "page-uuid" }] }`
  </creating>

<content>
Page body is read/written as Notion-flavored markdown:
- `read_page_content`: Returns full page body as markdown.
- `update_page_content` with mode "replace_content": Replaces entire body.
- `update_page_content` with mode "update_content": Search-and-replace specific text.

Notion markdown supports: headings, lists, to-dos, blockquotes, code blocks, dividers, callouts, toggles, columns, tables (HTML), equations, media, page/database references, and mentions.
</content>

<updating>
- Update only properties the user asked for.
- To clear a property: `{ "select": null }`, `{ "rich_text": [] }`.
- archive_page is the explicit wrapper for soft-deleting a page.
- For targeted edits, use "update_content" mode with old_str/new_str.
</updating>
