# `vercel`

The hosting platform under every Purdue Hackers site: the projects, builds and
deployments, the domains and certificates in front of them, the environment
variables and marketplace resources behind them, and the firewall, drains,
rolling releases and sandboxes around them. Everything is scoped to the
`purduehackers` team, whose id and slug are fixed and never passed by a caller.

It owns the platform layer — what was built, what is live, what it is reachable
at, and what it costs. It does not own what the running application says about
itself: exceptions, stack traces, grouping and user impact are `sentry`. It does
not own the source that produced a build; commits, pull requests and CI belong
to `github`. Authoritative DNS for a Purdue Hackers domain is `cloudflare`'s —
the DNS tools here reach only domains whose nameservers already point at Vercel.

Deployments are addressed by `dpl_…` id or by hostname, projects by `prj_…` id or
name, and almost nothing accepts the name a person actually says, so a `list_*`
call comes first.

<!-- generated: do not edit below this line -->

## Surface

**166 tools** across **11 skills**, plus 8 always-available.

## Skills

| Skill                                              | Role      | Tools | Description                                                                                                            |
| -------------------------------------------------- | --------- | ----: | ---------------------------------------------------------------------------------------------------------------------- |
| [`artifacts`](lib/skill_defs/artifacts.md)         | organizer |     3 | Inspect the Turborepo remote cache — status, artifact existence, and usage.                                            |
| [`deployments`](lib/skill_defs/deployments.md)     | organizer |    11 | Inspect and control deployments — list, view events, cancel, delete, promote, rollback.                                |
| [`domains`](lib/skill_defs/domains.md)             | organizer |    20 | Aliases, team domains, DNS records, registrar queries (availability, pricing, auth code), and TLS certs.               |
| [`edge-platform`](lib/skill_defs/edge-platform.md) | organizer |    34 | Global Config stores/items/tokens/backups, edge cache invalidation, native Vercel feature flags.                       |
| [`integrations`](lib/skill_defs/integrations.md)   | organizer |    12 | Browse installed integrations, provision new marketplace stores (Turso, Upstash Redis, Neon Postgres, Vercel Blob), a… |
| [`observability`](lib/skill_defs/observability.md) | organizer |    13 | Runtime logs, log/data drains, API Observability settings, and team audit events.                                      |
| [`projects`](lib/skill_defs/projects.md)           | organizer |    18 | Inspect and mutate Vercel projects — lifecycle, env vars (value-stripped on list), project domains, members.           |
| [`rollouts`](lib/skill_defs/rollouts.md)           | organizer |    12 | Rolling releases (canary rollouts) and deployment checks.                                                              |
| [`sandboxes`](lib/skill_defs/sandboxes.md)         | organizer |    11 | Vercel Sandbox lifecycle, shell commands, snapshots.                                                                   |
| [`security`](lib/skill_defs/security.md)           | organizer |     8 | Firewall configuration, attack challenge mode, bypass IPs, auth tokens.                                                |
| [`team-admin`](lib/skill_defs/team-admin.md)       | organizer |    22 | Team members, access groups, webhooks, project routes, connect networks, microfrontends, billing, custom environments. |

## Always available

Reachable without loading a skill.

| Tool               | Risk | Role   | What it does                                                                     |
| ------------------ | ---- | ------ | -------------------------------------------------------------------------------- |
| `get_deployment`   | read | public | Retrieve a deployment by its id (dpl_…) or URL hostname.                         |
| `get_project`      | read | public | Retrieve a single Vercel project by id or name (via search).                     |
| `list_aliases`     | read | public | List aliases for the active team.                                                |
| `list_deployments` | read | public | List deployments for the active team.                                            |
| `list_domains`     | read | public | List all apex domains registered to the active team.                             |
| `list_projects`    | read | public | List Vercel projects in the active team.                                         |
| `list_teams`       | read | public | List every Vercel team the authenticated account belongs to.                     |
| `whoami`           | read | public | Return the authenticated Vercel user and the active Purdue Hackers team context. |

## `artifacts`

Inspect the Turborepo remote cache — status, artifact existence, and usage.

| Tool               | Risk | Role   | What it does                                                    |
| ------------------ | ---- | ------ | --------------------------------------------------------------- |
| `artifact_exists`  | read | public | Check whether a Turborepo artifact with the given hash exists.  |
| `artifact_query`   | read | public | Query Turborepo artifact events and usage statistics by hashes. |
| `artifacts_status` | read | public | Get the Turborepo remote cache status for the team (enabled?    |

## `deployments`

Inspect and control deployments — list, view events, cancel, delete, promote, rollback.

| Tool                                   | Risk        | Role      | What it does                                                                       |
| -------------------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------- |
| `cancel_deployment`                    | destructive | organizer | Cancel an in-flight deployment (state must be BUILDING / QUEUED / INITIALIZING).   |
| `delete_deployment`                    | destructive | organizer | Permanently delete a deployment by id or URL.                                      |
| `get_deployment`                       | read        | public    | Retrieve a deployment by its id (dpl_…) or URL hostname.                           |
| `get_deployment_events`                | read        | public    | Fetch build events / logs for a deployment in JSON mode.                           |
| `get_deployment_file_contents`         | read        | public    | Get the contents of a specific file from a deployment.                             |
| `list_deployment_files`                | read        | public    | List the file tree of a deployment's source code.                                  |
| `list_deployments`                     | read        | public    | List deployments for the active team.                                              |
| `promote_deployment`                   | destructive | organizer | Promote a deployment to production without rebuilding it.                          |
| `rollback_deployment`                  | destructive | organizer | Roll production traffic back to an older deployment.                               |
| `update_integration_deployment_action` | write       | organizer | Update the deployment integration action state for a specific integration install. |
| `update_rollback_description`          | write       | organizer | Update the description (reason) attached to an active rollback.                    |

## `domains`

Aliases, team domains, DNS records, registrar queries (availability, pricing, auth code), and TLS certs.

| Tool                            | Risk        | Role      | What it does                                                                                      |
| ------------------------------- | ----------- | --------- | ------------------------------------------------------------------------------------------------- |
| `assign_alias`                  | destructive | organizer | Assign an alias (hostname) to a deployment.                                                       |
| `check_domain_availability`     | read        | public    | Check whether a domain is available to register.                                                  |
| `delete_alias`                  | destructive | organizer | Delete an alias by id or hostname.                                                                |
| `delete_domain`                 | destructive | organizer | Remove a domain from the team.                                                                    |
| `get_alias`                     | read        | public    | Retrieve a single alias by id or hostname.                                                        |
| `get_cert`                      | read        | public    | Retrieve a TLS certificate by id.                                                                 |
| `get_domain`                    | read        | public    | Retrieve a domain by name.                                                                        |
| `get_domain_auth_code`          | destructive | organizer | Retrieve the transfer auth code for a domain registered at the Vercel registrar.                  |
| `get_domain_config`             | read        | public    | Retrieve a domain's DNS / nameserver configuration — useful for diagnosing verification failures. |
| `get_domain_price`              | read        | public    | Get the price to register a specific domain for N years.                                          |
| `get_domain_transfer_in_status` | read        | public    | Get status of a pending inbound domain transfer.                                                  |
| `get_registrar_order`           | read        | public    | Retrieve a registrar order (from buy/transfer/renew) by its id.                                   |
| `issue_cert`                    | destructive | organizer | Issue a new TLS certificate for one or more hostnames on the team's domains.                      |
| `list_aliases`                  | read        | public    | List aliases for the active team.                                                                 |
| `list_deployment_aliases`       | read        | public    | List every alias currently pointing at a specific deployment id.                                  |
| `list_dns_records`              | read        | public    | List DNS records for a domain managed by Vercel nameservers.                                      |
| `list_domains`                  | read        | public    | List all apex domains registered to the active team.                                              |
| `list_supported_tlds`           | read        | public    | List top-level domains supported by the Vercel registrar.                                         |
| `remove_cert`                   | destructive | organizer | Remove a TLS certificate.                                                                         |
| `remove_dns_record`             | destructive | organizer | Remove a DNS record from a Vercel-managed domain.                                                 |

## `edge-platform`

Global Config stores/items/tokens/backups, edge cache invalidation, native Vercel feature flags.

| Tool                                          | Risk        | Role      | What it does                                                            |
| --------------------------------------------- | ----------- | --------- | ----------------------------------------------------------------------- |
| `create_global_config`                        | write       | organizer | Create a new Global Config store.                                       |
| `create_global_config_token`                  | write       | organizer | Create a new read token for a Global Config.                            |
| `create_sdk_key`                              | destructive | organizer | Create a new feature-flags SDK key for a project.                       |
| `dangerously_delete_edge_cache_by_src_images` | destructive | organizer | Forcefully delete image optimizer cache entries for source URLs.        |
| `dangerously_delete_edge_cache_by_tags`       | destructive | organizer | Forcefully delete (not just invalidate) cache entries by tag.           |
| `delete_flag`                                 | destructive | organizer | Permanently delete a feature flag.                                      |
| `delete_flag_segment`                         | destructive | organizer | Delete a targeting segment.                                             |
| `delete_global_config`                        | destructive | organizer | Permanently delete a Global Config store.                               |
| `delete_global_config_schema`                 | destructive | organizer | Delete the schema definition on a Global Config.                        |
| `delete_global_config_tokens`                 | destructive | organizer | Delete one or more Global Config read tokens.                           |
| `delete_sdk_key`                              | destructive | organizer | Delete a feature-flags SDK key.                                         |
| `get_deployment_feature_flags`                | read        | public    | Get the feature flags evaluated during a specific deployment.           |
| `get_flag`                                    | read        | public    | Get a feature flag by id.                                               |
| `get_flag_segment`                            | read        | public    | Get a specific flag segment.                                            |
| `get_flag_settings`                           | read        | public    | Get flag settings for a project.                                        |
| `get_global_config`                           | read        | public    | Retrieve a single Global Config by id.                                  |
| `get_global_config_backup`                    | read        | public    | Retrieve a specific Global Config backup.                               |
| `get_global_config_item`                      | read        | public    | Get a single item by key from a Global Config.                          |
| `get_global_config_schema`                    | read        | public    | Get the JSON Schema for a Global Config (validates future writes).      |
| `get_global_config_token`                     | read        | public    | Retrieve a specific Global Config read token's metadata.                |
| `invalidate_edge_cache_by_src_images`         | write       | organizer | Invalidate the image optimizer cache for specific source image URLs.    |
| `invalidate_edge_cache_by_tags`               | write       | organizer | Invalidate Vercel Edge Cache entries tagged with any of the given tags. |
| `list_flag_segments`                          | read        | public    | List targeting segments for feature flags on a project.                 |
| `list_flag_versions`                          | read        | public    | List historical versions of a feature flag.                             |
| `list_flags`                                  | read        | public    | List Vercel feature flags for a project.                                |
| `list_global_config_backups`                  | read        | public    | List automatic backups for a Global Config.                             |
| `list_global_config_items`                    | read        | public    | List all items in a Global Config.                                      |
| `list_global_config_tokens`                   | read        | public    | List read tokens for a Global Config.                                   |
| `list_global_configs`                         | read        | public    | List every Global Config store in the team.                             |
| `list_sdk_keys`                               | read        | public    | List SDK keys for Vercel feature flags on a project.                    |
| `list_team_flag_settings`                     | read        | public    | List feature-flag settings across every project on the team.            |
| `list_team_flags`                             | read        | public    | List every feature flag across the team's projects.                     |
| `patch_global_config_items`                   | destructive | organizer | Upsert or delete items in a Global Config.                              |
| `update_global_config`                        | destructive | organizer | Rename a Global Config.                                                 |

## `integrations`

Browse installed integrations, provision new marketplace stores (Turso, Upstash Redis, Neon Postgres, Vercel Blob), and connect them to projects.

| Tool                                      | Risk        | Role      | What it does                                                                                                            |
| ----------------------------------------- | ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `connect_integration_resource_to_project` | destructive | organizer | Connect a provisioned integration resource to a Vercel project.                                                         |
| `create_integration_store_direct`         | destructive | organizer | Provision a new integration resource — e.g.                                                                             |
| `delete_integration_configuration`        | destructive | organizer | Uninstall an integration.                                                                                               |
| `delete_integration_resource`             | destructive | organizer | Permanently delete a provisioned integration resource (e.g.                                                             |
| `get_integration_billing_plans`           | read        | public    | List billing plans for a specific product of an integration.                                                            |
| `get_integration_configuration`           | read        | public    | Get a specific integration configuration by id.                                                                         |
| `get_integration_configuration_products`  | read        | public    | List products offered by an installed integration — e.g.                                                                |
| `get_integration_resource`                | read        | public    | Retrieve a specific integration resource by id.                                                                         |
| `list_git_namespaces`                     | read        | public    | List Git namespaces (orgs/users) accessible to the team across GitHub/GitLab/Bitbucket integrations.                    |
| `list_integration_configurations`         | read        | public    | List every integration installed on the team (marketplace apps — Turso, Upstash, Neon, etc.).                           |
| `list_integration_resources`              | read        | public    | List every resource provisioned under an integration installation (e.g.                                                 |
| `search_git_repos`                        | read        | public    | Search Git repos available to the team across installed Git integrations — use when creating a new project from a repo. |

## `observability`

Runtime logs, log/data drains, API Observability settings, and team audit events.

| Tool                            | Risk        | Role      | What it does                                                                                                           |
| ------------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `delete_configurable_log_drain` | destructive | organizer | Delete a configurable log drain.                                                                                       |
| `delete_drain`                  | destructive | organizer | Delete a data drain.                                                                                                   |
| `delete_integration_log_drain`  | destructive | organizer | Delete an integration log drain.                                                                                       |
| `get_drain`                     | read        | public    | Retrieve a drain by id.                                                                                                |
| `get_log_drain`                 | read        | public    | Retrieve a configurable log drain by id.                                                                               |
| `get_observability_config`      | read        | public    | Retrieve the API Observability configuration for the team.                                                             |
| `get_runtime_logs`              | read        | public    | Fetch runtime logs for a specific deployment.                                                                          |
| `list_drains`                   | read        | public    | List every data drain (the newer generic drain API — supports logs, traces, metrics).                                  |
| `list_event_types`              | read        | public    | List every user-facing event type the audit log recognises.                                                            |
| `list_integration_log_drains`   | read        | public    | List integration-backed log drains (created by installed integrations).                                                |
| `list_log_drains`               | read        | public    | List every configurable log drain on the team.                                                                         |
| `list_user_events`              | read        | public    | List recent audit events for the authenticated user scoped to the active Vercel team — useful for investigating who r… |
| `update_observability_config`   | write       | organizer | Update the API Observability Plus setting (enabled/disabled) for a project.                                            |

## `projects`

Inspect and mutate Vercel projects — lifecycle, env vars (value-stripped on list), project domains, members.

| Tool                              | Risk        | Role      | What it does                                                                         |
| --------------------------------- | ----------- | --------- | ------------------------------------------------------------------------------------ |
| `create_project_env_vars`         | destructive | organizer | Create one or more environment variables on a project.                               |
| `create_project_transfer_request` | destructive | organizer | Create a project transfer request.                                                   |
| `delete_project`                  | destructive | organizer | Permanently delete a Vercel project and every deployment underneath it.              |
| `edit_project_env_var`            | destructive | organizer | Edit a single environment variable.                                                  |
| `get_project`                     | read        | public    | Retrieve a single Vercel project by id or name (via search).                         |
| `get_project_domain`              | read        | public    | Get a single project domain's details.                                               |
| `get_project_env_var`             | read        | public    | Retrieve a single environment variable by its id, **including its decrypted value**. |
| `list_project_domains`            | read        | public    | List domains attached to a project.                                                  |
| `list_project_env_vars`           | read        | public    | List environment variables for a project.                                            |
| `list_project_members`            | read        | public    | List members with access to a specific project.                                      |
| `list_projects`                   | read        | public    | List Vercel projects in the active team.                                             |
| `list_promote_aliases`            | read        | public    | List aliases from the most recent promote request.                                   |
| `pause_project`                   | destructive | organizer | Pause a project.                                                                     |
| `remove_project_domain`           | destructive | organizer | Remove a domain from a project.                                                      |
| `remove_project_env_var`          | destructive | organizer | Remove a single environment variable from a project by its id.                       |
| `remove_project_member`           | destructive | organizer | Remove a member from a project.                                                      |
| `unpause_project`                 | destructive | organizer | Unpause a previously paused project.                                                 |
| `verify_project_domain`           | write       | organizer | Trigger verification of a pending project domain.                                    |

## `rollouts`

Rolling releases (canary rollouts) and deployment checks.

| Tool                                 | Risk        | Role      | What it does                                                              |
| ------------------------------------ | ----------- | --------- | ------------------------------------------------------------------------- |
| `approve_rolling_release_stage`      | destructive | organizer | Advance an in-flight rolling release to the next stage.                   |
| `complete_rolling_release`           | destructive | organizer | Complete a rolling release — route 100% of traffic to the new deployment. |
| `delete_project_check`               | destructive | organizer | Delete a deployment check and all its runs.                               |
| `delete_rolling_release_config`      | destructive | organizer | Delete the rolling release configuration.                                 |
| `get_deployment_check_run`           | read        | public    | Get a check run's details.                                                |
| `get_project_check`                  | read        | public    | Get a deployment check by id.                                             |
| `get_rolling_release`                | read        | public    | Get the current rolling release (if any) for a project.                   |
| `get_rolling_release_billing_status` | read        | public    | Check whether a project is eligible to use rolling releases (plan-gated). |
| `get_rolling_release_config`         | read        | public    | Get the rolling release configuration (stages, thresholds) for a project. |
| `list_check_runs`                    | read        | public    | List runs for a specific check.                                           |
| `list_deployment_check_runs`         | read        | public    | List all check runs for a deployment.                                     |
| `list_project_checks`                | read        | public    | List deployment checks configured on a project.                           |

## `sandboxes`

Vercel Sandbox lifecycle, shell commands, snapshots.

| Tool                       | Risk        | Role      | What it does                                                              |
| -------------------------- | ----------- | --------- | ------------------------------------------------------------------------- |
| `delete_sandbox_snapshot`  | destructive | organizer | Delete a sandbox snapshot.                                                |
| `extend_sandbox_timeout`   | write       | organizer | Extend a sandbox's maximum runtime by an additional `duration` (seconds). |
| `get_sandbox`              | read        | public    | Retrieve a Vercel Sandbox by id.                                          |
| `get_sandbox_command`      | read        | public    | Retrieve a command by id.                                                 |
| `get_sandbox_command_logs` | read        | public    | Fetch stdout/stderr of a sandbox command.                                 |
| `get_sandbox_snapshot`     | read        | public    | Retrieve a sandbox snapshot by id.                                        |
| `kill_sandbox_command`     | destructive | organizer | Terminate a running sandbox command.                                      |
| `list_sandbox_commands`    | read        | public    | List commands that have been run inside a sandbox.                        |
| `list_sandbox_snapshots`   | read        | public    | List snapshots captured across the team's sandboxes.                      |
| `list_sandboxes`           | read        | public    | List every active Vercel Sandbox in the team.                             |
| `stop_sandbox`             | destructive | organizer | Stop a running Vercel Sandbox.                                            |

## `security`

Firewall configuration, attack challenge mode, bypass IPs, auth tokens.

| Tool                           | Risk        | Role      | What it does                                                                                |
| ------------------------------ | ----------- | --------- | ------------------------------------------------------------------------------------------- |
| `delete_auth_token`            | destructive | organizer | Revoke (delete) an auth token.                                                              |
| `get_active_attack_status`     | read        | public    | Check whether Vercel detects an active attack on a project.                                 |
| `get_auth_token`               | read        | public    | Retrieve a specific auth token's metadata.                                                  |
| `get_firewall_config`          | read        | public    | Retrieve a firewall configuration version for a project.                                    |
| `list_auth_tokens`             | read        | public    | List auth tokens for the currently-authenticated user.                                      |
| `list_bypass_ips`              | read        | public    | List IPs currently allowed to bypass firewall challenges.                                   |
| `list_firewall_events`         | read        | public    | List recent firewall events — blocked requests, challenged requests, rate-limit hits.       |
| `update_attack_challenge_mode` | destructive | organizer | Enable or disable attack challenge mode (shows a managed challenge page to suspected bots). |

## `team-admin`

Team members, access groups, webhooks, project routes, connect networks, microfrontends, billing, custom environments.

| Tool                          | Risk        | Role      | What it does                                                                                |
| ----------------------------- | ----------- | --------- | ------------------------------------------------------------------------------------------- |
| `delete_access_group`         | destructive | organizer | Delete an access group.                                                                     |
| `delete_connect_network`      | destructive | organizer | Delete a Vercel Connect private network.                                                    |
| `delete_team_invite_code`     | destructive | organizer | Delete a pending team invite code.                                                          |
| `delete_webhook`              | destructive | organizer | Delete a team webhook.                                                                      |
| `get_access_group`            | read        | public    | Retrieve an access group by id or name.                                                     |
| `get_connect_network`         | read        | public    | Retrieve a Vercel Connect network by id.                                                    |
| `get_custom_environment`      | read        | public    | Get a specific custom environment by id or slug.                                            |
| `get_team`                    | read        | public    | Retrieve a team by id or slug.                                                              |
| `get_webhook`                 | read        | public    | Retrieve a team webhook by id.                                                              |
| `list_access_group_members`   | read        | public    | List members of an access group.                                                            |
| `list_access_groups`          | read        | public    | List access groups on the team.                                                             |
| `list_billing_charges`        | read        | public    | List billing charges for the team between `from` and `to` (ISO 8601 UTC date-time strings). |
| `list_connect_networks`       | read        | public    | List Vercel Connect private networks on the team.                                           |
| `list_contract_commitments`   | read        | public    | List contractual billing commitments.                                                       |
| `list_custom_environments`    | read        | public    | List custom preview environments for a project.                                             |
| `list_microfrontend_groups`   | read        | public    | List microfrontend groups on the team.                                                      |
| `list_project_route_versions` | read        | public    | List historical versions of a project's routing rules.                                      |
| `list_project_routes`         | read        | public    | List routing rules for a project (from the Routing Middleware subsystem).                   |
| `list_team_members`           | read        | public    | List members of the active team.                                                            |
| `list_webhooks`               | read        | public    | List team webhooks.                                                                         |
| `remove_custom_environment`   | destructive | organizer | Remove a custom preview environment from a project.                                         |
| `remove_team_member`          | destructive | organizer | Remove a member from the active team.                                                       |
