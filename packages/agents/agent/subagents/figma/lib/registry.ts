/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice. Splitting them is what lets a domain
 * accumulate tools that no single skill describes. `tool_defs/` mirrors the
 * skill list exactly, and `check:capabilities` fails if it stops doing so.
 *
 * This module imports skill prose from `lib/skill_defs/<name>.md` as text. That
 * keeps the markdown a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import commentsDoc from "./skill_defs/comments.md" with { type: "text" };
import componentsDoc from "./skill_defs/components.md" with { type: "text" };
import devResourcesDoc from "./skill_defs/dev-resources.md" with { type: "text" };
import nodesDoc from "./skill_defs/nodes.md" with { type: "text" };
import variablesDoc from "./skill_defs/variables.md" with { type: "text" };
import versionsDoc from "./skill_defs/versions.md" with { type: "text" };
import webhooksDoc from "./skill_defs/webhooks.md" with { type: "text" };
import { get_file } from "./tool_defs/base/get_file.ts";
import { list_project_files } from "./tool_defs/base/list_project_files.ts";
import { list_projects } from "./tool_defs/base/list_projects.ts";
import { search_files } from "./tool_defs/base/search_files.ts";
import { add_reaction } from "./tool_defs/comments/add_reaction.ts";
import { create_comment } from "./tool_defs/comments/create_comment.ts";
import { delete_comment } from "./tool_defs/comments/delete_comment.ts";
import { delete_reaction } from "./tool_defs/comments/delete_reaction.ts";
import { list_comments } from "./tool_defs/comments/list_comments.ts";
import { get_component } from "./tool_defs/components/get_component.ts";
import { get_component_set } from "./tool_defs/components/get_component_set.ts";
import { get_style } from "./tool_defs/components/get_style.ts";
import { list_file_components } from "./tool_defs/components/list_file_components.ts";
import { list_file_styles } from "./tool_defs/components/list_file_styles.ts";
import { list_team_component_sets } from "./tool_defs/components/list_team_component_sets.ts";
import { list_team_components } from "./tool_defs/components/list_team_components.ts";
import { list_team_styles } from "./tool_defs/components/list_team_styles.ts";
import { create_dev_resources } from "./tool_defs/dev-resources/create_dev_resources.ts";
import { delete_dev_resource } from "./tool_defs/dev-resources/delete_dev_resource.ts";
import { list_dev_resources } from "./tool_defs/dev-resources/list_dev_resources.ts";
import { update_dev_resource } from "./tool_defs/dev-resources/update_dev_resource.ts";
import { get_file_nodes } from "./tool_defs/nodes/get_file_nodes.ts";
import { get_image_fills } from "./tool_defs/nodes/get_image_fills.ts";
import { get_images } from "./tool_defs/nodes/get_images.ts";
import { get_local_variables } from "./tool_defs/variables/get_local_variables.ts";
import { get_published_variables } from "./tool_defs/variables/get_published_variables.ts";
import { modify_variables } from "./tool_defs/variables/modify_variables.ts";
import { list_versions } from "./tool_defs/versions/list_versions.ts";
import { create_webhook } from "./tool_defs/webhooks/create_webhook.ts";
import { delete_webhook } from "./tool_defs/webhooks/delete_webhook.ts";
import { get_webhook } from "./tool_defs/webhooks/get_webhook.ts";
import { list_team_webhooks } from "./tool_defs/webhooks/list_team_webhooks.ts";
import { update_webhook } from "./tool_defs/webhooks/update_webhook.ts";

export const FIGMA_TOOLS = {
  add_reaction,
  create_comment,
  create_dev_resources,
  create_webhook,
  delete_comment,
  delete_dev_resource,
  delete_reaction,
  delete_webhook,
  get_component,
  get_component_set,
  get_file,
  get_file_nodes,
  get_image_fills,
  get_images,
  get_local_variables,
  get_published_variables,
  get_style,
  get_webhook,
  list_comments,
  list_dev_resources,
  list_file_components,
  list_file_styles,
  list_project_files,
  list_projects,
  list_team_component_sets,
  list_team_components,
  list_team_styles,
  list_team_webhooks,
  list_versions,
  modify_variables,
  search_files,
  update_dev_resource,
  update_webhook,
} as const satisfies Record<string, DomainToolSpec>;

export type FigmaToolName = keyof typeof FIGMA_TOOLS;

export const FIGMA_BASE_TOOL_NAMES = [
  "get_file",
  "list_projects",
  "list_project_files",
  "search_files",
] as const;

export const FIGMA_SKILLS = [
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
