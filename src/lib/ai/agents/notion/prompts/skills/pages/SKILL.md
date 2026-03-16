---
name: pages
description: Create, update, read, and edit pages — properties and Notion-flavored markdown content.
criteria: Use when the user wants to create a new page, update page properties, read or edit page content, or retrieve specific property values.
tools: create_page, update_page, retrieve_page_property, read_page_content, update_page_content
---

<creating>
- Determine the parent first: is the page going into a database (entry/row) or under another page (subpage)?
- For database parents: always retrieve_database first to understand the property schema. Set properties matching the schema.
- For page parents: search_notion to find the parent page by name, then create_page with page_id parent.
- Title: for database pages, use the title property name from the schema (often "Name" or "Title"). If `properties.title` is omitted, the first `# h1` heading in the markdown body becomes the title.
- Only set properties the user explicitly asked for. Don't populate optional fields speculatively.
- Body content via the `markdown` parameter — write it as Notion-flavored markdown (see syntax reference below).

<property_formats>
Common property value formats for create/update:

- title: `{ "title": [{ "text": { "content": "text" } }] }`
- rich_text: `{ "rich_text": [{ "text": { "content": "text" } }] }`
- number: `{ "number": 42 }`
- select: `{ "select": { "name": "Option" } }`
- multi_select: `{ "multi_select": [{ "name": "Tag1" }, { "name": "Tag2" }] }`
- status: `{ "status": { "name": "In Progress" } }`
- date: `{ "date": { "start": "2024-01-15", "end": "2024-01-20" } }` (end is optional)
- checkbox: `{ "checkbox": true }`
- url: `{ "url": "https://..." }`
- email: `{ "email": "user@example.com" }`
- people: `{ "people": [{ "id": "user-uuid" }] }` (resolve via list_users)
- relation: `{ "relation": [{ "id": "page-uuid" }] }` (resolve via search_notion)
  </property_formats>
  </creating>

<content>
Page body content is read and written as Notion-flavored markdown via the native markdown API.

- `read_page_content`: Returns the full page body as markdown. Call before editing.
- `update_page_content` with mode "replace_content": Replaces the entire page body with new markdown.
- `update_page_content` with mode "update_content": Search-and-replace specific text. Use for targeted edits.
- `create_page` also accepts a `markdown` parameter for initial body content.

<markdown_syntax>
Notion-flavored markdown syntax reference:

Basic blocks:

- `# Heading 1`, `## Heading 2`, `### Heading 3` (h4-h6 convert to h4)
- `- Bulleted item` and `1. Numbered item`
- `- [ ] To-do` and `- [x] Completed to-do`
- `> Blockquote` (multi-line with `<br>` within a single line)
- Triple backticks for code blocks with optional language (e.g. ```python)
- `---` for dividers
- Use tabs for indentation — child blocks are indented one tab deeper than their parent.

Inline formatting:

- `**bold**`, `*italic*`, `~~strikethrough~~`, `` `inline code` ``
- `[link text](URL)` for links
- `$equation$` for inline math
- `<span underline="true">underlined text</span>`
- `<span color="red">colored text</span>` or `<span color="blue_bg">highlighted text</span>`
- Colors: gray, brown, orange, yellow, green, blue, purple, pink, red (add `_bg` suffix for background)

Callouts:

```
<callout icon="💡" color="yellow_bg">
	Callout content here
	- Can contain child blocks
</callout>
```

Toggle blocks:

```
<details>
<summary>Toggle title</summary>
	Content revealed when opened
</details>
```

Or toggle headings: `# Heading {toggle="true"}`

Columns:

```
<columns>
	<column>
		Left column content
	</column>
	<column>
		Right column content
	</column>
</columns>
```

Tables (HTML):

```
<table header-row="true">
	<tr>
		<td>Header 1</td>
		<td>Header 2</td>
	</tr>
	<tr>
		<td>Cell 1</td>
		<td>Cell 2</td>
	</tr>
</table>
```

Block equations:

```
$$
E = mc^2
$$
```

Media:

- Images: `![Caption](URL)`
- Video: `<video src="URL">Caption</video>`
- Audio: `<audio src="URL">Caption</audio>`
- File: `<file src="URL">Caption</file>`

Page/database references:

- `<page url="notion-url">Page Title</page>`
- `<database url="notion-url">Database Title</database>`

Mentions:

- `<mention-user url="user-url">Name</mention-user>`
- `<mention-page url="page-url">Page Title</mention-page>`
- `<mention-date start="2024-01-15"/>`
- `<mention-date start="2024-01-15" end="2024-01-20"/>`

Other:

- `<table_of_contents/>` for a table of contents block
- `<empty-block/>` for an empty paragraph
  </markdown_syntax>
  </content>

<updating>
- Update only the properties the user asked for. Don't touch other fields.
- To clear a property, set it to its empty value (e.g., `{ "select": null }`, `{ "rich_text": [] }`).
- Archive a page by setting `archived: true`. This is Notion's soft-delete — "delete" always means archive.
- Icon: emoji string or external URL. Cover: external URL.
- To edit body content, use `update_page_content`. Read first with `read_page_content` to see current state.
- For targeted edits, use "update_content" mode with old_str/new_str — this preserves formatting on untouched content.
- For full rewrites, use "replace_content" mode with the complete new markdown.
</updating>

<property_retrieval>

- Use retrieve_page for a summary of all properties with inline values.
- Use retrieve_page_property for paginated properties (relations with many items, rollups, formulas). Pass the property_id from retrieve_page results.
  </property_retrieval>
