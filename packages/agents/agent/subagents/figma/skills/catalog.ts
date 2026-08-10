import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import commentsDoc from "../lib/skill_defs/comments.md" with { type: "text" };
import componentsDoc from "../lib/skill_defs/components.md" with { type: "text" };
import devResourcesDoc from "../lib/skill_defs/dev-resources.md" with { type: "text" };
import nodesDoc from "../lib/skill_defs/nodes.md" with { type: "text" };
import variablesDoc from "../lib/skill_defs/variables.md" with { type: "text" };
import versionsDoc from "../lib/skill_defs/versions.md" with { type: "text" };
import webhooksDoc from "../lib/skill_defs/webhooks.md" with { type: "text" };

export const FIGMA_BASE_TOOL_NAMES = [
  "get_file",
  "list_projects",
  "list_project_files",
  "search_files",
] as const;

export const FIGMA_SKILL_DEFINITIONS = [
  {
    name: "comments",
    minRole: "organizer",
    doc: commentsDoc,
    tools: ["list_comments", "create_comment", "delete_comment", "add_reaction", "delete_reaction"],
  },
  {
    name: "components",
    minRole: "organizer",
    doc: componentsDoc,
    tools: [
      "list_team_components",
      "list_file_components",
      "get_component",
      "list_team_component_sets",
      "get_component_set",
      "list_team_styles",
      "list_file_styles",
      "get_style",
    ],
  },
  {
    name: "dev-resources",
    minRole: "organizer",
    doc: devResourcesDoc,
    tools: [
      "list_dev_resources",
      "create_dev_resources",
      "update_dev_resource",
      "delete_dev_resource",
    ],
  },
  {
    name: "nodes",
    minRole: "organizer",
    doc: nodesDoc,
    tools: ["get_file_nodes", "get_images", "get_image_fills"],
  },
  {
    name: "variables",
    minRole: "organizer",
    doc: variablesDoc,
    tools: ["get_local_variables", "get_published_variables", "modify_variables"],
  },
  {
    name: "versions",
    minRole: "organizer",
    doc: versionsDoc,
    tools: ["list_versions"],
  },
  {
    name: "webhooks",
    minRole: "admin",
    doc: webhooksDoc,
    tools: [
      "list_team_webhooks",
      "create_webhook",
      "get_webhook",
      "update_webhook",
      "delete_webhook",
    ],
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, FIGMA_SKILL_DEFINITIONS),
  },
});
