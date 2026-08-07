import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import * as m_base from "./base.ts";
import * as m_blocks from "./blocks.ts";
import * as m_comments from "./comments.ts";
import * as m_databases from "./databases.ts";
import * as m_pages from "./pages.ts";

export const NOTION_TOOLS = {
  append_block_children: m_blocks.append_block_children,
  archive_database: m_databases.archive_database,
  archive_page: m_pages.archive_page,
  create_comment: m_comments.create_comment,
  create_database: m_databases.create_database,
  create_page: m_pages.create_page,
  delete_block: m_blocks.delete_block,
  list_block_children: m_blocks.list_block_children,
  list_comments: m_comments.list_comments,
  list_users: m_base.list_users,
  query_database: m_databases.query_database,
  read_page_content: m_pages.read_page_content,
  retrieve_block: m_blocks.retrieve_block,
  retrieve_bot_user: m_base.retrieve_bot_user,
  retrieve_comment: m_comments.retrieve_comment,
  retrieve_database: m_base.retrieve_database,
  retrieve_page: m_base.retrieve_page,
  retrieve_page_property: m_pages.retrieve_page_property,
  retrieve_user: m_base.retrieve_user,
  search_notion: m_base.search_notion,
  update_block: m_blocks.update_block,
  update_database: m_databases.update_database,
  update_page: m_pages.update_page,
  update_page_content: m_pages.update_page_content,
} as const satisfies Record<string, DomainToolSpec>;
