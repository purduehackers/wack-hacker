import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type LegacySkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

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

export const VERCEL_SKILL_DEFINITIONS = [
  {
    name: "artifacts",
    description: "Inspect the Turborepo remote cache — status, artifact existence, and usage.",
    criteria:
      "Use when the user asks about the Turborepo remote cache, build artifacts, cache hits/usage, or whether a specific artifact hash is cached.",
    minRole: "organizer",
    tools: ["artifacts_status", "artifact_exists", "artifact_query"],
    instructions:
      "<remote-cache>\n- artifacts_status reports whether the Turborepo remote cache is enabled and the team's usage.\n- artifact_exists checks whether an artifact with a given hash is cached (a HEAD-style probe).\n- artifact_query returns artifact events and usage statistics for one or more hashes.\n</remote-cache>",
  },
  {
    name: "deployments",
    description:
      "Inspect and control deployments — list, view events, cancel, delete, promote, rollback.",
    criteria:
      "Use when the user asks about specific deployments, build events, canceling an in-flight build, promoting/rolling back production, or investigating deployment files.",
    minRole: "organizer",
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
    instructions:
      '<inspection>\n- `get_deployment_events` accepts `idOrUrl` (deployment id or URL hostname) and caps `limit` at 200.\n- `list_deployment_files` returns a tree; use `get_deployment_file_contents` to fetch a file (base64).\n</inspection>\n\n<traffic>\n- `promote_deployment` and `rollback_deployment` are asynchronous — they return `{ ok: true, note: "..." }` immediately. Poll `list_promote_aliases` (projects sub-skill) to watch traffic shift.\n- Rolling releases may override promote/rollback behaviour — check `get_rolling_release_config` first.\n- Cancel only works on `BUILDING`/`QUEUED`/`INITIALIZING` deployments.\n</traffic>\n\n<deletion>\n- `delete_deployment` is permanent and cannot target the active production deployment.\n</deletion>',
  },
  {
    name: "domains",
    description:
      "Aliases, team domains, DNS records, registrar queries (availability, pricing, auth code), and TLS certs.",
    criteria:
      "Use when the user asks about URL aliases, apex domains, DNS records, domain availability or pricing on Vercel registrar, or TLS certificates.",
    minRole: "organizer",
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
    instructions:
      "<aliases>\n- An alias points a hostname at a specific deployment.\n- `assign_alias` can break existing production traffic — confirm before running on a prod hostname.\n</aliases>\n\n<dns>\n- DNS writes aren't exposed here (the SDK's strict enum for record types makes them brittle through this subagent). For DNS changes, direct the user to the Vercel dashboard or use the CLI.\n</dns>\n\n<registrar>\n- Read queries (availability, pricing, TLDs, auth code) are safe to run freely.\n- Actual domain purchases (`buy_single_domain` etc.) are deliberately not exposed here — direct the user to the Vercel dashboard to avoid charging the account accidentally.\n</registrar>\n\n<certs>\n- `issue_cert` re-issues TLS certs — useful after domain verification. Generally only needed when Vercel's auto-issue fails.\n- `remove_cert` breaks HTTPS for anything bound to it. Confirm before running.\n</certs>",
  },
  {
    name: "edge-platform",
    description:
      "Global Config stores/items/tokens/backups, edge cache invalidation, native Vercel feature flags.",
    criteria:
      "Use when the user asks about Global Config, cache invalidation (by tag or image URL), or Vercel's native feature flags and SDK keys.",
    minRole: "organizer",
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
    instructions:
      "<global-config>\n- `patch_global_config_items` batches upsert/update/delete ops. Preferred over individual writes.\n- Deleting a token breaks any client that was using it — confirm before running.\n</global-config>\n\n<edge-cache>\n- Prefer `invalidate_*` tools over `dangerously_delete_*`: invalidate is faster and cheaper.\n- Use `dangerously_delete_*` only when you need storage freed immediately.\n</edge-cache>\n\n<feature-flags>\n- `create_flag` and `update_flag` are omitted from this subagent because their request bodies have deep nested variant configs that don't translate cleanly. Direct the user to the Vercel dashboard for those.\n- `delete_sdk_key` takes the SDK key's hash (aliased as `key_id` in this tool) — clients using that key will break.\n</feature-flags>",
  },
  {
    name: "integrations",
    description:
      "Browse installed integrations, provision new marketplace stores (Turso, Upstash Redis, Neon Postgres, Vercel Blob), and connect them to projects.",
    criteria:
      "Use when the user asks about marketplace integrations, provisioning a new database/KV/blob store, attaching a provisioned store to a project, rotating integration secrets, or searching git repos for a new project.",
    minRole: "organizer",
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
    instructions:
      '<provisioning-flow>\nThe standard flow to create a new store (e.g. Turso database, Upstash Redis):\n\n1. Call `list_integration_configurations` with `view: "account"` to find the installed integration (Turso, Upstash, Neon, etc.) and its configuration id.\n2. Call `get_integration_configuration_products` with the configuration id to list products (e.g. `database`, `kv`, `blob`).\n3. Call `get_integration_billing_plans` with the integration slug and product slug to see pricing. **Confirm with the user before a paid plan.**\n4. Call `create_integration_store_direct` with the configuration id, product slug, and a name. Returns a resource id.\n5. Call `connect_integration_resource_to_project` with the resource id + project id. Env vars auto-populate on the project; **a fresh deployment is required for them to take effect.**\n   </provisioning-flow>\n\n<deletion>\n- `delete_integration_resource` **destroys the underlying store** (drops the Turso DB, etc.). Data is unrecoverable.\n- `delete_integration_configuration` uninstalls an integration. Resources may detach.\n</deletion>\n\n<git>\n- `search_git_repos` helps locate a GitHub/GitLab/Bitbucket repo for a new project. `list_git_namespaces` gives the org list.\n</git>',
  },
  {
    name: "observability",
    description:
      "Runtime logs, log/data drains, API Observability settings, and team audit events.",
    criteria:
      "Use when the user asks about runtime logs, where logs are exported (log drains / data drains), API Observability settings, or the team's audit/activity events.",
    minRole: "organizer",
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
    instructions:
      "<runtime-logs>\n- get_runtime_logs pulls recent runtime logs for a deployment/project.\n</runtime-logs>\n\n<drains>\n- Drains forward logs/events to an external destination. Three flavours:\n  - Configurable log drains: list_log_drains / get_log_drain / delete_configurable_log_drain.\n  - Integration log drains (created by installed integrations): list_integration_log_drains / delete_integration_log_drain.\n  - Data drains (newer API, any event stream): list_drains / get_drain / delete_drain.\n- Every delete_* here is destructive and prompts for confirmation — pass the exact drain id.\n</drains>\n\n<observability-config>\n- get_observability_config reads the team's API Observability configuration.\n- update_observability_config toggles API Observability Plus (enabled/disabled) for a project.\n</observability-config>\n\n<audit-events>\n- list_user_events returns the team's audit/activity events; list_event_types lists the event types you can filter on.\n</audit-events>",
  },
  {
    name: "projects",
    description:
      "Inspect and mutate Vercel projects — lifecycle, env vars (value-stripped on list), project domains, members.",
    criteria:
      "Use when the user asks about a Vercel project's configuration, env vars, attached domains, members, pausing/unpausing, or deleting a project.",
    minRole: "organizer",
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
    instructions:
      "<env-vars>\n- `list_project_env_vars` ALWAYS strips `value`. Never surface raw env var values unless the user explicitly asks, and even then use `get_project_env_var` which returns a single decrypted value.\n- Env var writes (create/edit/remove) require a restart of the affected deployment to take effect.\n- Scope is `production`, `preview`, or `development`. Most variables use all three.\n</env-vars>\n\n<domains>\n- `verify_project_domain` re-runs the verification challenge; it doesn't change config.\n- `remove_project_domain` detaches from the project but doesn't delete the domain registration.\n</domains>\n\n<writes>\n- `delete_project` is irreversible — confirm the project id/name twice.\n- `pause_project` blocks active production deployments; `unpause_project` reverses.\n- `create_project_transfer_request` returns a 24-hour `code` for the accepting team.\n</writes>",
  },
  {
    name: "rollouts",
    description: "Rolling releases (canary rollouts) and deployment checks.",
    criteria:
      "Use when the user asks about rolling releases, gradual deployments, approving release stages, or deployment checks (pre-deploy CI-style gates).",
    minRole: "organizer",
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
    instructions:
      "<rolling-releases>\n- `get_rolling_release_billing_status` checks whether the project's plan supports rolling releases (feature is plan-gated).\n- `approve_rolling_release_stage` requires `canaryDeploymentId` and `nextStageIndex`. Shifts live production traffic.\n- `complete_rolling_release` routes 100% of traffic to the canary deployment immediately.\n- `delete_rolling_release_config` removes the rolling release setup; future deploys ship to 100% on first release.\n</rolling-releases>\n\n<checks>\n- Check runs gate deployments. Use `list_project_checks` to see configured checks; `list_deployment_check_runs` to see runs on a specific deployment.\n- Creating new checks isn't exposed here (the SDK types for `CreateProjectCheckRequestBody` require a complex source config). Direct the user to the Vercel dashboard.\n</checks>",
  },
  {
    name: "sandboxes",
    description: "Vercel Sandbox lifecycle, shell commands, snapshots.",
    criteria:
      "Use when the user asks about Vercel Sandboxes — running ad-hoc commands in ephemeral environments, listing active sandboxes, or managing snapshots.",
    minRole: "organizer",
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
    instructions:
      "<compute-cost>\n- Sandboxes consume billable compute. `extend_sandbox_timeout` extends the clock; `stop_sandbox` stops the meter.\n- Commands kicked off via the SDK run asynchronously — poll `get_sandbox_command` / `get_sandbox_command_logs`.\n</compute-cost>\n\n<scope>\n- This subagent does NOT expose `run_sandbox_command`, file I/O, sandbox creation, or network policy writes — those have complex request shapes and should be driven from the CLI or dashboard.\n</scope>\n\n<snapshots>\n- Snapshots capture sandbox state. Deleting one does not affect running sandboxes.\n</snapshots>",
  },
  {
    name: "security",
    description: "Firewall configuration, attack challenge mode, bypass IPs, auth tokens.",
    criteria:
      "Use when the user asks about firewall rules, attack challenge mode, bypass IPs, firewall events, or managing Vercel auth tokens.",
    minRole: "organizer",
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
    instructions:
      '<firewall>\n- `get_firewall_config` takes `configVersion: "active"` for the live version (or a specific version id).\n- Updating the firewall config is deliberately not exposed — its nested rule types make it risky to drive from an LLM. Direct the user to the dashboard.\n</firewall>\n\n<attack-mode>\n- `update_attack_challenge_mode` shows a managed challenge page to suspected bots. Can gate legitimate users — use sparingly and disable once the attack subsides.\n- `attackModeActiveUntil` is an auto-expiration (unix ms). Omit for indefinite.\n</attack-mode>\n\n<bypass-ips>\n- Bypass IPs skip all firewall protections for that IP. List-only here; writes are intentionally omitted.\n</bypass-ips>\n\n<auth-tokens>\n- `delete_auth_token` immediately revokes the token. Any script holding it breaks.\n- Creating new auth tokens is deliberately not exposed — generate from the Vercel dashboard to keep the token handling out of Discord.\n</auth-tokens>',
  },
  {
    name: "team-admin",
    description:
      "Team members, access groups, webhooks, project routes, connect networks, microfrontends, billing, custom environments.",
    criteria:
      "Use when the user asks about team membership, access groups, team webhooks, project routes, Vercel Connect private networks, microfrontend groups, billing charges, or custom preview environments.",
    minRole: "organizer",
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
    instructions:
      "<members>\n- `remove_team_member` requires the user id. Use `list_team_members` to resolve names to ids.\n- Team creation/invite/role-change tools are deliberately not exposed — they have complex request bodies that don't translate well from LLM inputs.\n</members>\n\n<access-groups>\n- Groups bundle project roles. Deleting a group revokes its members' access to all attached projects.\n</access-groups>\n\n<webhooks>\n- Deleting a webhook stops delivery. Any downstream consumer breaks.\n</webhooks>\n\n<routes>\n- Read-only from this subagent. Route writes require a Routing Middleware deploy anyway.\n</routes>\n\n<billing>\n- `list_billing_charges` requires `from` and `to` ISO 8601 UTC date-time strings.\n- `list_contract_commitments` is team-scoped, no date required.\n</billing>\n\n<custom-environments>\n- Custom environments are per-project branch-bound preview contexts.\n- `remove_custom_environment` can also delete unassigned env vars if `deleteUnassignedEnvironmentVariables: true` — be deliberate.\n</custom-environments>",
  },
] as const satisfies readonly LegacySkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, VERCEL_SKILL_DEFINITIONS),
  },
});
