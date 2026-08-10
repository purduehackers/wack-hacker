import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type LegacySkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const NOTION_BASE_TOOL_NAMES = [
  "search_notion",
  "retrieve_page",
  "retrieve_database",
  "list_users",
] as const;

export const NOTION_SKILL_DEFINITIONS = [
  {
    name: "blocks",
    description:
      "Read and modify individual Notion blocks — retrieve, update, archive, list children, and append.",
    criteria:
      "Use when the user wants fine-grained block manipulation on a Notion page (individual paragraphs, toggles, callouts) rather than replacing whole-page content.",
    minRole: "organizer",
    tools: [
      "retrieve_block",
      "update_block",
      "delete_block",
      "list_block_children",
      "append_block_children",
    ],
    instructions:
      "- Block types: paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, to_do, toggle, callout, quote, code, divider, image, bookmark, equation, table, table_row, column, column_list, synced_block, template, child_page, child_database.\n- update_block payload must match the existing block's type (keyed by block type).\n- delete_block archives — Notion has no hard-delete for blocks.\n- append_block_children takes plain block objects (e.g. `{ paragraph: { rich_text: [{ text: { content: '...' } }] } }`).\n- For page-level markdown edits, prefer update_page_content in the pages skill — it's faster for bulk changes.",
  },
  {
    name: "comments",
    description: "Create and list comments on pages and blocks.",
    criteria:
      "Use when the user wants to comment on a page, read existing comments, or reply in a discussion thread.",
    minRole: "organizer",
    tools: ["create_comment", "list_comments", "retrieve_comment"],
    instructions:
      '<creating>\n- For new comments on a page: use parent_type "page_id" with the page\'s ID.\n- For replies: use parent_type "discussion_id" with the discussion thread ID from list_comments results.\n- Pass comment content as plain text via the `text` parameter.\n- Only comment when the user explicitly asks. Normal chat replies don\'t require Notion comments.\n- Search for the target page first via search_notion if referenced by name.\n</creating>\n\n<listing>\n- list_comments reads comments on a page or block. Pass the page/block ID as block_id.\n- Results include comment text, author, timestamp, and discussion_id for threading.\n- Results are paginated — use start_cursor for more.\n</listing>',
  },
  {
    name: "databases",
    description: "Query database entries with filters/sorts; create and update databases.",
    criteria:
      "Use when the user wants to query, filter, or sort database entries, or create/modify a database schema.",
    minRole: "organizer",
    tools: ["query_database", "create_database", "update_database", "archive_database"],
    instructions:
      '<querying>\n- Always retrieve_database first to understand the schema. Property names and types must match exactly.\n\nFilter syntax — single property:\n`{ "property": "Status", "status": { "equals": "In Progress" } }`\n\nAND compound:\n`{ "and": [{ "property": "Status", "status": { "equals": "Done" } }, { "property": "Priority", "select": { "equals": "High" } }] }`\n\nOR compound:\n`{ "or": [{ "property": "Status", "status": { "equals": "In Progress" } }, { "property": "Status", "status": { "equals": "Not Started" } }] }`\n\nFilter operators by type:\n\n- title/rich_text: equals, contains, starts_with, ends_with, is_empty, is_not_empty\n- number: equals, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to\n- select/status: equals, does_not_equal, is_empty, is_not_empty\n- multi_select: contains, does_not_contain, is_empty, is_not_empty\n- date: equals, before, after, on_or_before, on_or_after, past_week, past_month, next_week, next_month\n- checkbox: equals, does_not_equal\n- people/relation: contains, does_not_contain, is_empty, is_not_empty\n\nSort syntax: `[{ "property": "Created", "direction": "descending" }]`\n</querying>\n\n<creating>\n- Databases must have a parent page.\n- Every database needs at least a title property: `{ "Name": { "title": {} } }`.\n- Only include properties the user asked for.\n</creating>\n\n<updating>\n- To add a property, include it in properties. To rename, use the property ID as key.\n- To delete a property, set it to null.\n</updating>',
  },
  {
    name: "pages",
    description:
      "Create, update, read, and edit pages — properties and Notion-flavored markdown content.",
    criteria:
      "Use when the user wants to create a new page, update page properties, read or edit page content.",
    minRole: "organizer",
    tools: [
      "create_page",
      "update_page",
      "archive_page",
      "retrieve_page_property",
      "read_page_content",
      "update_page_content",
      "retrieve_user",
      "retrieve_bot_user",
    ],
    instructions:
      '<creating>\n- Determine the parent: database (entry/row) or page (subpage).\n- For database parents: always retrieve_database first for the property schema.\n- For page parents: search_notion to find the parent page by name.\n- Body content via the `markdown` parameter — write as Notion-flavored markdown.\n- Only set properties the user explicitly asked for.\n\nProperty value formats:\n\n- title: `{ "title": [{ "text": { "content": "text" } }] }`\n- rich_text: `{ "rich_text": [{ "text": { "content": "text" } }] }`\n- number: `{ "number": 42 }`\n- select: `{ "select": { "name": "Option" } }`\n- multi_select: `{ "multi_select": [{ "name": "Tag1" }] }`\n- status: `{ "status": { "name": "In Progress" } }`\n- date: `{ "date": { "start": "2024-01-15" } }`\n- checkbox: `{ "checkbox": true }`\n- url: `{ "url": "https://..." }`\n- people: `{ "people": [{ "id": "user-uuid" }] }` (resolve via list_users)\n- relation: `{ "relation": [{ "id": "page-uuid" }] }`\n  </creating>\n\n<content>\nPage body is read/written as Notion-flavored markdown:\n- `read_page_content`: Returns full page body as markdown.\n- `update_page_content` with mode "replace_content": Replaces entire body.\n- `update_page_content` with mode "update_content": Search-and-replace specific text.\n\nNotion markdown supports: headings, lists, to-dos, blockquotes, code blocks, dividers, callouts, toggles, columns, tables (HTML), equations, media, page/database references, and mentions.\n</content>\n\n<updating>\n- Update only properties the user asked for.\n- To clear a property: `{ "select": null }`, `{ "rich_text": [] }`.\n- archive_page is the explicit wrapper for soft-deleting a page.\n- For targeted edits, use "update_content" mode with old_str/new_str.\n</updating>',
  },
] as const satisfies readonly LegacySkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, NOTION_SKILL_DEFINITIONS),
  },
});
