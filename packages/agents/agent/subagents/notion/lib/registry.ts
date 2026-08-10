/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and splitting them lets a tool exist that no
 * skill describes. `tool_defs/` mirrors the skill list exactly, and
 * `check:capabilities` fails if it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import blocksDoc from "./skill_defs/blocks.md" with { type: "text" };
import commentsDoc from "./skill_defs/comments.md" with { type: "text" };
import databasesDoc from "./skill_defs/databases.md" with { type: "text" };
import pagesDoc from "./skill_defs/pages.md" with { type: "text" };
import { list_users } from "./tool_defs/base/list_users.ts";
import { retrieve_database } from "./tool_defs/base/retrieve_database.ts";
import { retrieve_page } from "./tool_defs/base/retrieve_page.ts";
import { search_notion } from "./tool_defs/base/search_notion.ts";
import { append_block_children } from "./tool_defs/blocks/append_block_children.ts";
import { delete_block } from "./tool_defs/blocks/delete_block.ts";
import { list_block_children } from "./tool_defs/blocks/list_block_children.ts";
import { retrieve_block } from "./tool_defs/blocks/retrieve_block.ts";
import { update_block } from "./tool_defs/blocks/update_block.ts";
import { create_comment } from "./tool_defs/comments/create_comment.ts";
import { list_comments } from "./tool_defs/comments/list_comments.ts";
import { retrieve_comment } from "./tool_defs/comments/retrieve_comment.ts";
import { archive_database } from "./tool_defs/databases/archive_database.ts";
import { create_database } from "./tool_defs/databases/create_database.ts";
import { query_database } from "./tool_defs/databases/query_database.ts";
import { update_database } from "./tool_defs/databases/update_database.ts";
import { archive_page } from "./tool_defs/pages/archive_page.ts";
import { create_page } from "./tool_defs/pages/create_page.ts";
import { read_page_content } from "./tool_defs/pages/read_page_content.ts";
import { retrieve_bot_user } from "./tool_defs/pages/retrieve_bot_user.ts";
import { retrieve_page_property } from "./tool_defs/pages/retrieve_page_property.ts";
import { retrieve_user } from "./tool_defs/pages/retrieve_user.ts";
import { update_page } from "./tool_defs/pages/update_page.ts";
import { update_page_content } from "./tool_defs/pages/update_page_content.ts";

export const NOTION_TOOLS = {
  append_block_children,
  archive_database,
  archive_page,
  create_comment,
  create_database,
  create_page,
  delete_block,
  list_block_children,
  list_comments,
  list_users,
  query_database,
  read_page_content,
  retrieve_block,
  retrieve_bot_user,
  retrieve_comment,
  retrieve_database,
  retrieve_page,
  retrieve_page_property,
  retrieve_user,
  search_notion,
  update_block,
  update_database,
  update_page,
  update_page_content,
} as const satisfies Record<string, DomainToolSpec>;

export type NotionToolName = keyof typeof NOTION_TOOLS;

export const NOTION_BASE_TOOL_NAMES = [
  "search_notion",
  "retrieve_page",
  "retrieve_database",
  "list_users",
] as const;

export const NOTION_SKILLS = [
  {
    name: "blocks",
    minRole: "organizer",
    doc: blocksDoc,
    tools: [
      "retrieve_block",
      "update_block",
      "delete_block",
      "list_block_children",
      "append_block_children",
    ],
  },
  {
    name: "comments",
    minRole: "organizer",
    doc: commentsDoc,
    tools: ["create_comment", "list_comments", "retrieve_comment"],
  },
  {
    name: "databases",
    minRole: "organizer",
    doc: databasesDoc,
    tools: ["query_database", "create_database", "update_database", "archive_database"],
  },
  {
    name: "pages",
    minRole: "organizer",
    doc: pagesDoc,
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
  },
] as const satisfies readonly IntegrationSkillDefinition[];
