/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and splitting them is what let the old
 * `edge.ts` accumulate 34 tools spanning three unrelated products that no
 * single file described. `tool_defs/` mirrors the skill list exactly, and
 * `check:capabilities` fails if it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import artifactsDoc from "./skill_defs/artifacts.md" with { type: "text" };
import deploymentsDoc from "./skill_defs/deployments.md" with { type: "text" };
import domainsDoc from "./skill_defs/domains.md" with { type: "text" };
import edgePlatformDoc from "./skill_defs/edge-platform.md" with { type: "text" };
import integrationsDoc from "./skill_defs/integrations.md" with { type: "text" };
import observabilityDoc from "./skill_defs/observability.md" with { type: "text" };
import projectsDoc from "./skill_defs/projects.md" with { type: "text" };
import rolloutsDoc from "./skill_defs/rollouts.md" with { type: "text" };
import sandboxesDoc from "./skill_defs/sandboxes.md" with { type: "text" };
import securityDoc from "./skill_defs/security.md" with { type: "text" };
import teamAdminDoc from "./skill_defs/team-admin.md" with { type: "text" };
import { artifact_exists } from "./tool_defs/artifacts/artifact_exists.ts";
import { artifact_query } from "./tool_defs/artifacts/artifact_query.ts";
import { artifacts_status } from "./tool_defs/artifacts/artifacts_status.ts";
import { get_deployment } from "./tool_defs/base/get_deployment.ts";
import { get_project } from "./tool_defs/base/get_project.ts";
import { list_aliases } from "./tool_defs/base/list_aliases.ts";
import { list_deployments } from "./tool_defs/base/list_deployments.ts";
import { list_domains } from "./tool_defs/base/list_domains.ts";
import { list_projects } from "./tool_defs/base/list_projects.ts";
import { list_teams } from "./tool_defs/base/list_teams.ts";
import { whoami } from "./tool_defs/base/whoami.ts";
import { cancel_deployment } from "./tool_defs/deployments/cancel_deployment.ts";
import { delete_deployment } from "./tool_defs/deployments/delete_deployment.ts";
import { get_deployment_events } from "./tool_defs/deployments/get_deployment_events.ts";
import { get_deployment_file_contents } from "./tool_defs/deployments/get_deployment_file_contents.ts";
import { list_deployment_files } from "./tool_defs/deployments/list_deployment_files.ts";
import { promote_deployment } from "./tool_defs/deployments/promote_deployment.ts";
import { rollback_deployment } from "./tool_defs/deployments/rollback_deployment.ts";
import { update_integration_deployment_action } from "./tool_defs/deployments/update_integration_deployment_action.ts";
import { update_rollback_description } from "./tool_defs/deployments/update_rollback_description.ts";
import { assign_alias } from "./tool_defs/domains/assign_alias.ts";
import { check_domain_availability } from "./tool_defs/domains/check_domain_availability.ts";
import { delete_alias } from "./tool_defs/domains/delete_alias.ts";
import { delete_domain } from "./tool_defs/domains/delete_domain.ts";
import { get_alias } from "./tool_defs/domains/get_alias.ts";
import { get_cert } from "./tool_defs/domains/get_cert.ts";
import { get_domain } from "./tool_defs/domains/get_domain.ts";
import { get_domain_auth_code } from "./tool_defs/domains/get_domain_auth_code.ts";
import { get_domain_config } from "./tool_defs/domains/get_domain_config.ts";
import { get_domain_price } from "./tool_defs/domains/get_domain_price.ts";
import { get_domain_transfer_in_status } from "./tool_defs/domains/get_domain_transfer_in_status.ts";
import { get_registrar_order } from "./tool_defs/domains/get_registrar_order.ts";
import { issue_cert } from "./tool_defs/domains/issue_cert.ts";
import { list_deployment_aliases } from "./tool_defs/domains/list_deployment_aliases.ts";
import { list_dns_records } from "./tool_defs/domains/list_dns_records.ts";
import { list_supported_tlds } from "./tool_defs/domains/list_supported_tlds.ts";
import { remove_cert } from "./tool_defs/domains/remove_cert.ts";
import { remove_dns_record } from "./tool_defs/domains/remove_dns_record.ts";
import { create_global_config } from "./tool_defs/edge-platform/create_global_config.ts";
import { create_global_config_token } from "./tool_defs/edge-platform/create_global_config_token.ts";
import { create_sdk_key } from "./tool_defs/edge-platform/create_sdk_key.ts";
import { dangerously_delete_edge_cache_by_src_images } from "./tool_defs/edge-platform/dangerously_delete_edge_cache_by_src_images.ts";
import { dangerously_delete_edge_cache_by_tags } from "./tool_defs/edge-platform/dangerously_delete_edge_cache_by_tags.ts";
import { delete_flag } from "./tool_defs/edge-platform/delete_flag.ts";
import { delete_flag_segment } from "./tool_defs/edge-platform/delete_flag_segment.ts";
import { delete_global_config } from "./tool_defs/edge-platform/delete_global_config.ts";
import { delete_global_config_schema } from "./tool_defs/edge-platform/delete_global_config_schema.ts";
import { delete_global_config_tokens } from "./tool_defs/edge-platform/delete_global_config_tokens.ts";
import { delete_sdk_key } from "./tool_defs/edge-platform/delete_sdk_key.ts";
import { get_deployment_feature_flags } from "./tool_defs/edge-platform/get_deployment_feature_flags.ts";
import { get_flag } from "./tool_defs/edge-platform/get_flag.ts";
import { get_flag_segment } from "./tool_defs/edge-platform/get_flag_segment.ts";
import { get_flag_settings } from "./tool_defs/edge-platform/get_flag_settings.ts";
import { get_global_config } from "./tool_defs/edge-platform/get_global_config.ts";
import { get_global_config_backup } from "./tool_defs/edge-platform/get_global_config_backup.ts";
import { get_global_config_item } from "./tool_defs/edge-platform/get_global_config_item.ts";
import { get_global_config_schema } from "./tool_defs/edge-platform/get_global_config_schema.ts";
import { get_global_config_token } from "./tool_defs/edge-platform/get_global_config_token.ts";
import { invalidate_edge_cache_by_src_images } from "./tool_defs/edge-platform/invalidate_edge_cache_by_src_images.ts";
import { invalidate_edge_cache_by_tags } from "./tool_defs/edge-platform/invalidate_edge_cache_by_tags.ts";
import { list_flag_segments } from "./tool_defs/edge-platform/list_flag_segments.ts";
import { list_flag_versions } from "./tool_defs/edge-platform/list_flag_versions.ts";
import { list_flags } from "./tool_defs/edge-platform/list_flags.ts";
import { list_global_config_backups } from "./tool_defs/edge-platform/list_global_config_backups.ts";
import { list_global_config_items } from "./tool_defs/edge-platform/list_global_config_items.ts";
import { list_global_config_tokens } from "./tool_defs/edge-platform/list_global_config_tokens.ts";
import { list_global_configs } from "./tool_defs/edge-platform/list_global_configs.ts";
import { list_sdk_keys } from "./tool_defs/edge-platform/list_sdk_keys.ts";
import { list_team_flag_settings } from "./tool_defs/edge-platform/list_team_flag_settings.ts";
import { list_team_flags } from "./tool_defs/edge-platform/list_team_flags.ts";
import { patch_global_config_items } from "./tool_defs/edge-platform/patch_global_config_items.ts";
import { update_global_config } from "./tool_defs/edge-platform/update_global_config.ts";
import { connect_integration_resource_to_project } from "./tool_defs/integrations/connect_integration_resource_to_project.ts";
import { create_integration_store_direct } from "./tool_defs/integrations/create_integration_store_direct.ts";
import { delete_integration_configuration } from "./tool_defs/integrations/delete_integration_configuration.ts";
import { delete_integration_resource } from "./tool_defs/integrations/delete_integration_resource.ts";
import { get_integration_billing_plans } from "./tool_defs/integrations/get_integration_billing_plans.ts";
import { get_integration_configuration } from "./tool_defs/integrations/get_integration_configuration.ts";
import { get_integration_configuration_products } from "./tool_defs/integrations/get_integration_configuration_products.ts";
import { get_integration_resource } from "./tool_defs/integrations/get_integration_resource.ts";
import { list_git_namespaces } from "./tool_defs/integrations/list_git_namespaces.ts";
import { list_integration_configurations } from "./tool_defs/integrations/list_integration_configurations.ts";
import { list_integration_resources } from "./tool_defs/integrations/list_integration_resources.ts";
import { search_git_repos } from "./tool_defs/integrations/search_git_repos.ts";
import { delete_configurable_log_drain } from "./tool_defs/observability/delete_configurable_log_drain.ts";
import { delete_drain } from "./tool_defs/observability/delete_drain.ts";
import { delete_integration_log_drain } from "./tool_defs/observability/delete_integration_log_drain.ts";
import { get_drain } from "./tool_defs/observability/get_drain.ts";
import { get_log_drain } from "./tool_defs/observability/get_log_drain.ts";
import { get_observability_config } from "./tool_defs/observability/get_observability_config.ts";
import { get_runtime_logs } from "./tool_defs/observability/get_runtime_logs.ts";
import { list_drains } from "./tool_defs/observability/list_drains.ts";
import { list_event_types } from "./tool_defs/observability/list_event_types.ts";
import { list_integration_log_drains } from "./tool_defs/observability/list_integration_log_drains.ts";
import { list_log_drains } from "./tool_defs/observability/list_log_drains.ts";
import { list_user_events } from "./tool_defs/observability/list_user_events.ts";
import { update_observability_config } from "./tool_defs/observability/update_observability_config.ts";
import { create_project_env_vars } from "./tool_defs/projects/create_project_env_vars.ts";
import { create_project_transfer_request } from "./tool_defs/projects/create_project_transfer_request.ts";
import { delete_project } from "./tool_defs/projects/delete_project.ts";
import { edit_project_env_var } from "./tool_defs/projects/edit_project_env_var.ts";
import { get_project_domain } from "./tool_defs/projects/get_project_domain.ts";
import { get_project_env_var } from "./tool_defs/projects/get_project_env_var.ts";
import { list_project_domains } from "./tool_defs/projects/list_project_domains.ts";
import { list_project_env_vars } from "./tool_defs/projects/list_project_env_vars.ts";
import { list_project_members } from "./tool_defs/projects/list_project_members.ts";
import { list_promote_aliases } from "./tool_defs/projects/list_promote_aliases.ts";
import { pause_project } from "./tool_defs/projects/pause_project.ts";
import { remove_project_domain } from "./tool_defs/projects/remove_project_domain.ts";
import { remove_project_env_var } from "./tool_defs/projects/remove_project_env_var.ts";
import { remove_project_member } from "./tool_defs/projects/remove_project_member.ts";
import { unpause_project } from "./tool_defs/projects/unpause_project.ts";
import { verify_project_domain } from "./tool_defs/projects/verify_project_domain.ts";
import { approve_rolling_release_stage } from "./tool_defs/rollouts/approve_rolling_release_stage.ts";
import { complete_rolling_release } from "./tool_defs/rollouts/complete_rolling_release.ts";
import { delete_project_check } from "./tool_defs/rollouts/delete_project_check.ts";
import { delete_rolling_release_config } from "./tool_defs/rollouts/delete_rolling_release_config.ts";
import { get_deployment_check_run } from "./tool_defs/rollouts/get_deployment_check_run.ts";
import { get_project_check } from "./tool_defs/rollouts/get_project_check.ts";
import { get_rolling_release } from "./tool_defs/rollouts/get_rolling_release.ts";
import { get_rolling_release_billing_status } from "./tool_defs/rollouts/get_rolling_release_billing_status.ts";
import { get_rolling_release_config } from "./tool_defs/rollouts/get_rolling_release_config.ts";
import { list_check_runs } from "./tool_defs/rollouts/list_check_runs.ts";
import { list_deployment_check_runs } from "./tool_defs/rollouts/list_deployment_check_runs.ts";
import { list_project_checks } from "./tool_defs/rollouts/list_project_checks.ts";
import { delete_sandbox_snapshot } from "./tool_defs/sandboxes/delete_sandbox_snapshot.ts";
import { extend_sandbox_timeout } from "./tool_defs/sandboxes/extend_sandbox_timeout.ts";
import { get_sandbox } from "./tool_defs/sandboxes/get_sandbox.ts";
import { get_sandbox_command } from "./tool_defs/sandboxes/get_sandbox_command.ts";
import { get_sandbox_command_logs } from "./tool_defs/sandboxes/get_sandbox_command_logs.ts";
import { get_sandbox_snapshot } from "./tool_defs/sandboxes/get_sandbox_snapshot.ts";
import { kill_sandbox_command } from "./tool_defs/sandboxes/kill_sandbox_command.ts";
import { list_sandbox_commands } from "./tool_defs/sandboxes/list_sandbox_commands.ts";
import { list_sandbox_snapshots } from "./tool_defs/sandboxes/list_sandbox_snapshots.ts";
import { list_sandboxes } from "./tool_defs/sandboxes/list_sandboxes.ts";
import { stop_sandbox } from "./tool_defs/sandboxes/stop_sandbox.ts";
import { delete_auth_token } from "./tool_defs/security/delete_auth_token.ts";
import { get_active_attack_status } from "./tool_defs/security/get_active_attack_status.ts";
import { get_auth_token } from "./tool_defs/security/get_auth_token.ts";
import { get_firewall_config } from "./tool_defs/security/get_firewall_config.ts";
import { list_auth_tokens } from "./tool_defs/security/list_auth_tokens.ts";
import { list_bypass_ips } from "./tool_defs/security/list_bypass_ips.ts";
import { list_firewall_events } from "./tool_defs/security/list_firewall_events.ts";
import { update_attack_challenge_mode } from "./tool_defs/security/update_attack_challenge_mode.ts";
import { delete_access_group } from "./tool_defs/team-admin/delete_access_group.ts";
import { delete_connect_network } from "./tool_defs/team-admin/delete_connect_network.ts";
import { delete_team_invite_code } from "./tool_defs/team-admin/delete_team_invite_code.ts";
import { delete_webhook } from "./tool_defs/team-admin/delete_webhook.ts";
import { get_access_group } from "./tool_defs/team-admin/get_access_group.ts";
import { get_connect_network } from "./tool_defs/team-admin/get_connect_network.ts";
import { get_custom_environment } from "./tool_defs/team-admin/get_custom_environment.ts";
import { get_team } from "./tool_defs/team-admin/get_team.ts";
import { get_webhook } from "./tool_defs/team-admin/get_webhook.ts";
import { list_access_group_members } from "./tool_defs/team-admin/list_access_group_members.ts";
import { list_access_groups } from "./tool_defs/team-admin/list_access_groups.ts";
import { list_billing_charges } from "./tool_defs/team-admin/list_billing_charges.ts";
import { list_connect_networks } from "./tool_defs/team-admin/list_connect_networks.ts";
import { list_contract_commitments } from "./tool_defs/team-admin/list_contract_commitments.ts";
import { list_custom_environments } from "./tool_defs/team-admin/list_custom_environments.ts";
import { list_microfrontend_groups } from "./tool_defs/team-admin/list_microfrontend_groups.ts";
import { list_project_route_versions } from "./tool_defs/team-admin/list_project_route_versions.ts";
import { list_project_routes } from "./tool_defs/team-admin/list_project_routes.ts";
import { list_team_members } from "./tool_defs/team-admin/list_team_members.ts";
import { list_webhooks } from "./tool_defs/team-admin/list_webhooks.ts";
import { remove_custom_environment } from "./tool_defs/team-admin/remove_custom_environment.ts";
import { remove_team_member } from "./tool_defs/team-admin/remove_team_member.ts";

export const VERCEL_TOOLS = {
  approve_rolling_release_stage,
  artifact_exists,
  artifact_query,
  artifacts_status,
  assign_alias,
  cancel_deployment,
  check_domain_availability,
  complete_rolling_release,
  connect_integration_resource_to_project,
  create_global_config,
  create_global_config_token,
  create_integration_store_direct,
  create_project_env_vars,
  create_project_transfer_request,
  create_sdk_key,
  dangerously_delete_edge_cache_by_src_images,
  dangerously_delete_edge_cache_by_tags,
  delete_access_group,
  delete_alias,
  delete_auth_token,
  delete_configurable_log_drain,
  delete_connect_network,
  delete_deployment,
  delete_domain,
  delete_drain,
  delete_flag,
  delete_flag_segment,
  delete_global_config,
  delete_global_config_schema,
  delete_global_config_tokens,
  delete_integration_configuration,
  delete_integration_log_drain,
  delete_integration_resource,
  delete_project,
  delete_project_check,
  delete_rolling_release_config,
  delete_sandbox_snapshot,
  delete_sdk_key,
  delete_team_invite_code,
  delete_webhook,
  edit_project_env_var,
  extend_sandbox_timeout,
  get_access_group,
  get_active_attack_status,
  get_alias,
  get_auth_token,
  get_cert,
  get_connect_network,
  get_custom_environment,
  get_deployment,
  get_deployment_check_run,
  get_deployment_events,
  get_deployment_feature_flags,
  get_deployment_file_contents,
  get_domain,
  get_domain_auth_code,
  get_domain_config,
  get_domain_price,
  get_domain_transfer_in_status,
  get_drain,
  get_firewall_config,
  get_flag,
  get_flag_segment,
  get_flag_settings,
  get_global_config,
  get_global_config_backup,
  get_global_config_item,
  get_global_config_schema,
  get_global_config_token,
  get_integration_billing_plans,
  get_integration_configuration,
  get_integration_configuration_products,
  get_integration_resource,
  get_log_drain,
  get_observability_config,
  get_project,
  get_project_check,
  get_project_domain,
  get_project_env_var,
  get_registrar_order,
  get_rolling_release,
  get_rolling_release_billing_status,
  get_rolling_release_config,
  get_runtime_logs,
  get_sandbox,
  get_sandbox_command,
  get_sandbox_command_logs,
  get_sandbox_snapshot,
  get_team,
  get_webhook,
  invalidate_edge_cache_by_src_images,
  invalidate_edge_cache_by_tags,
  issue_cert,
  kill_sandbox_command,
  list_access_group_members,
  list_access_groups,
  list_aliases,
  list_auth_tokens,
  list_billing_charges,
  list_bypass_ips,
  list_check_runs,
  list_connect_networks,
  list_contract_commitments,
  list_custom_environments,
  list_deployment_aliases,
  list_deployment_check_runs,
  list_deployment_files,
  list_deployments,
  list_dns_records,
  list_domains,
  list_drains,
  list_event_types,
  list_firewall_events,
  list_flag_segments,
  list_flag_versions,
  list_flags,
  list_git_namespaces,
  list_global_config_backups,
  list_global_config_items,
  list_global_config_tokens,
  list_global_configs,
  list_integration_configurations,
  list_integration_log_drains,
  list_integration_resources,
  list_log_drains,
  list_microfrontend_groups,
  list_project_checks,
  list_project_domains,
  list_project_env_vars,
  list_project_members,
  list_project_route_versions,
  list_project_routes,
  list_projects,
  list_promote_aliases,
  list_sandbox_commands,
  list_sandbox_snapshots,
  list_sandboxes,
  list_sdk_keys,
  list_supported_tlds,
  list_team_flag_settings,
  list_team_flags,
  list_team_members,
  list_teams,
  list_user_events,
  list_webhooks,
  patch_global_config_items,
  pause_project,
  promote_deployment,
  remove_cert,
  remove_custom_environment,
  remove_dns_record,
  remove_project_domain,
  remove_project_env_var,
  remove_project_member,
  remove_team_member,
  rollback_deployment,
  search_git_repos,
  stop_sandbox,
  unpause_project,
  update_attack_challenge_mode,
  update_global_config,
  update_integration_deployment_action,
  update_observability_config,
  update_rollback_description,
  verify_project_domain,
  whoami,
} as const satisfies Record<string, DomainToolSpec>;

export type VercelToolName = keyof typeof VERCEL_TOOLS;

export const VERCEL_BASE_TOOL_NAMES = [
  "list_projects",
  "get_project",
  "list_deployments",
  "get_deployment",
  "list_aliases",
  "list_domains",
  "whoami",
  "list_teams",
] as const;

export const VERCEL_SKILLS = [
  {
    name: "artifacts",
    minRole: "organizer",
    doc: artifactsDoc,
    tools: ["artifacts_status", "artifact_exists", "artifact_query"],
  },
  {
    name: "deployments",
    minRole: "organizer",
    doc: deploymentsDoc,
    tools: [
      "list_deployments",
      "get_deployment",
      "get_deployment_events",
      "list_deployment_files",
      "get_deployment_file_contents",
      "cancel_deployment",
      "delete_deployment",
      "update_integration_deployment_action",
      "promote_deployment",
      "rollback_deployment",
      "update_rollback_description",
    ],
  },
  {
    name: "domains",
    minRole: "organizer",
    doc: domainsDoc,
    tools: [
      "list_aliases",
      "get_alias",
      "list_deployment_aliases",
      "assign_alias",
      "delete_alias",
      "list_domains",
      "get_domain",
      "get_domain_config",
      "delete_domain",
      "list_dns_records",
      "remove_dns_record",
      "list_supported_tlds",
      "check_domain_availability",
      "get_domain_price",
      "get_domain_auth_code",
      "get_domain_transfer_in_status",
      "get_registrar_order",
      "get_cert",
      "issue_cert",
      "remove_cert",
    ],
  },
  {
    name: "edge-platform",
    minRole: "organizer",
    doc: edgePlatformDoc,
    tools: [
      "list_global_configs",
      "get_global_config",
      "create_global_config",
      "update_global_config",
      "delete_global_config",
      "list_global_config_items",
      "get_global_config_item",
      "patch_global_config_items",
      "get_global_config_schema",
      "delete_global_config_schema",
      "list_global_config_tokens",
      "get_global_config_token",
      "create_global_config_token",
      "delete_global_config_tokens",
      "list_global_config_backups",
      "get_global_config_backup",
      "invalidate_edge_cache_by_tags",
      "dangerously_delete_edge_cache_by_tags",
      "invalidate_edge_cache_by_src_images",
      "dangerously_delete_edge_cache_by_src_images",
      "list_flags",
      "get_flag",
      "delete_flag",
      "list_flag_versions",
      "get_flag_settings",
      "list_team_flag_settings",
      "list_team_flags",
      "list_flag_segments",
      "get_flag_segment",
      "delete_flag_segment",
      "get_deployment_feature_flags",
      "list_sdk_keys",
      "create_sdk_key",
      "delete_sdk_key",
    ],
  },
  {
    name: "integrations",
    minRole: "organizer",
    doc: integrationsDoc,
    tools: [
      "list_integration_configurations",
      "get_integration_configuration",
      "get_integration_configuration_products",
      "get_integration_billing_plans",
      "delete_integration_configuration",
      "create_integration_store_direct",
      "connect_integration_resource_to_project",
      "list_integration_resources",
      "get_integration_resource",
      "delete_integration_resource",
      "list_git_namespaces",
      "search_git_repos",
    ],
  },
  {
    name: "observability",
    minRole: "organizer",
    doc: observabilityDoc,
    tools: [
      "get_runtime_logs",
      "list_log_drains",
      "get_log_drain",
      "delete_configurable_log_drain",
      "list_integration_log_drains",
      "delete_integration_log_drain",
      "list_drains",
      "get_drain",
      "delete_drain",
      "get_observability_config",
      "update_observability_config",
      "list_user_events",
      "list_event_types",
    ],
  },
  {
    name: "projects",
    minRole: "organizer",
    doc: projectsDoc,
    tools: [
      "list_projects",
      "get_project",
      "delete_project",
      "pause_project",
      "unpause_project",
      "create_project_transfer_request",
      "list_project_env_vars",
      "get_project_env_var",
      "create_project_env_vars",
      "edit_project_env_var",
      "remove_project_env_var",
      "list_project_domains",
      "get_project_domain",
      "remove_project_domain",
      "verify_project_domain",
      "list_promote_aliases",
      "list_project_members",
      "remove_project_member",
    ],
  },
  {
    name: "rollouts",
    minRole: "organizer",
    doc: rolloutsDoc,
    tools: [
      "get_rolling_release",
      "get_rolling_release_config",
      "get_rolling_release_billing_status",
      "delete_rolling_release_config",
      "approve_rolling_release_stage",
      "complete_rolling_release",
      "list_project_checks",
      "get_project_check",
      "delete_project_check",
      "list_check_runs",
      "list_deployment_check_runs",
      "get_deployment_check_run",
    ],
  },
  {
    name: "sandboxes",
    minRole: "organizer",
    doc: sandboxesDoc,
    tools: [
      "list_sandboxes",
      "get_sandbox",
      "stop_sandbox",
      "extend_sandbox_timeout",
      "list_sandbox_commands",
      "get_sandbox_command",
      "get_sandbox_command_logs",
      "kill_sandbox_command",
      "list_sandbox_snapshots",
      "get_sandbox_snapshot",
      "delete_sandbox_snapshot",
    ],
  },
  {
    name: "security",
    minRole: "organizer",
    doc: securityDoc,
    tools: [
      "get_firewall_config",
      "get_active_attack_status",
      "update_attack_challenge_mode",
      "list_bypass_ips",
      "list_firewall_events",
      "list_auth_tokens",
      "get_auth_token",
      "delete_auth_token",
    ],
  },
  {
    name: "team-admin",
    minRole: "organizer",
    doc: teamAdminDoc,
    tools: [
      "get_team",
      "list_team_members",
      "remove_team_member",
      "delete_team_invite_code",
      "list_access_groups",
      "get_access_group",
      "delete_access_group",
      "list_access_group_members",
      "list_webhooks",
      "get_webhook",
      "delete_webhook",
      "list_project_routes",
      "list_project_route_versions",
      "list_connect_networks",
      "get_connect_network",
      "delete_connect_network",
      "list_microfrontend_groups",
      "list_billing_charges",
      "list_contract_commitments",
      "list_custom_environments",
      "get_custom_environment",
      "remove_custom_environment",
    ],
  },
] as const satisfies readonly IntegrationSkillDefinition[];
