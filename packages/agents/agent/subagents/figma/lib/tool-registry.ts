import * as m_base from "./base.ts";
import * as m_comments from "./comments.ts";
import * as m_components from "./components.ts";
import type { FigmaToolSpec } from "./define-tool.ts";
import * as m_dev_resources from "./dev-resources.ts";
import * as m_nodes from "./nodes.ts";
import * as m_variables from "./variables.ts";
import * as m_versions from "./versions.ts";
import * as m_webhooks from "./webhooks.ts";

export const FIGMA_TOOLS = {
  add_reaction: m_comments.add_reaction,
  create_comment: m_comments.create_comment,
  create_dev_resources: m_dev_resources.create_dev_resources,
  create_webhook: m_webhooks.create_webhook,
  delete_comment: m_comments.delete_comment,
  delete_dev_resource: m_dev_resources.delete_dev_resource,
  delete_reaction: m_comments.delete_reaction,
  delete_webhook: m_webhooks.delete_webhook,
  get_component: m_components.get_component,
  get_component_set: m_components.get_component_set,
  get_file: m_base.get_file,
  get_file_nodes: m_nodes.get_file_nodes,
  get_image_fills: m_nodes.get_image_fills,
  get_images: m_nodes.get_images,
  get_local_variables: m_variables.get_local_variables,
  get_published_variables: m_variables.get_published_variables,
  get_style: m_components.get_style,
  get_webhook: m_webhooks.get_webhook,
  list_comments: m_comments.list_comments,
  list_dev_resources: m_dev_resources.list_dev_resources,
  list_file_components: m_components.list_file_components,
  list_file_styles: m_components.list_file_styles,
  list_project_files: m_base.list_project_files,
  list_projects: m_base.list_projects,
  list_team_component_sets: m_components.list_team_component_sets,
  list_team_components: m_components.list_team_components,
  list_team_styles: m_components.list_team_styles,
  list_team_webhooks: m_webhooks.list_team_webhooks,
  list_versions: m_versions.list_versions,
  modify_variables: m_variables.modify_variables,
  search_files: m_base.search_files,
  update_dev_resource: m_dev_resources.update_dev_resource,
  update_webhook: m_webhooks.update_webhook,
} as const satisfies Record<string, FigmaToolSpec>;

export type FigmaToolName = keyof typeof FIGMA_TOOLS;
