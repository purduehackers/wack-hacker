import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import blocksDoc from "../lib/skill_defs/blocks.md" with { type: "text" };
import commentsDoc from "../lib/skill_defs/comments.md" with { type: "text" };
import databasesDoc from "../lib/skill_defs/databases.md" with { type: "text" };
import pagesDoc from "../lib/skill_defs/pages.md" with { type: "text" };

export const NOTION_BASE_TOOL_NAMES = [
  "search_notion",
  "retrieve_page",
  "retrieve_database",
  "list_users",
] as const;

export const NOTION_SKILL_DEFINITIONS = [
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

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, NOTION_SKILL_DEFINITIONS),
  },
});
