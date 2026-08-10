# `sentry`

Application error tracking and observability for every Purdue Hackers service
reporting into the Sentry organization: issues and their events, releases and
deploys, performance and profiling, session replays, cron monitors, logs, and
the alert rules that decide when a human hears about any of it.

It owns what the running application says about itself. It does not own why a
build failed or which deployment is live — that is `vercel`. It does not own the
source of a stack trace, and reads no repository; a fix goes through `github`. A
Sentry issue is a fault report, not a work item, so tracking the work to fix one
belongs in `linear`.

Projects are addressed by slug and `list_projects` is how a slug is found.
Issues are addressed by their numeric id; the `PROJECT-123` form users quote
from the UI is a short id and is not accepted in its place.

<!-- generated: do not edit below this line -->

## Surface

**68 tools** across **15 skills**, plus 4 always-available.

## Skills

| Skill                                                          | Role      | Tools | Description                                                                                     |
| -------------------------------------------------------------- | --------- | ----: | ----------------------------------------------------------------------------------------------- |
| [`alerts`](lib/skill_defs/alerts.md)                           | organizer |     7 | List, create, update, and delete issue and metric alert rules.                                  |
| [`events`](lib/skill_defs/events.md)                           | organizer |     4 | List and inspect error events, stack traces, and breadcrumbs.                                   |
| [`issue-management`](lib/skill_defs/issue-management.md)       | organizer |     5 | Update, resolve, ignore, assign, delete, and tag issues.                                        |
| [`log-search`](lib/skill_defs/log-search.md)                   | organizer |     2 | Search structured logs and inspect log volume over time.                                        |
| [`members`](lib/skill_defs/members.md)                         | organizer |    11 | List and manage organization members and teams; view team membership.                           |
| [`membership`](lib/skill_defs/membership.md)                   | admin     |     2 | Invite new members to the Sentry organization or remove existing ones (admin only).             |
| [`metrics`](lib/skill_defs/metrics.md)                         | organizer |     4 | Query custom metrics — counters, distributions, gauges, and sets.                               |
| [`monitors`](lib/skill_defs/monitors.md)                       | organizer |     5 | Manage cron monitors — view schedules, check-in history, and configure runtime limits.          |
| [`performance`](lib/skill_defs/performance.md)                 | organizer |     3 | Query transaction performance, latency, throughput, and span data.                              |
| [`profiling`](lib/skill_defs/profiling.md)                     | organizer |     2 | View CPU profiling data — flamegraphs and slowest functions.                                    |
| [`projects-management`](lib/skill_defs/projects-management.md) | admin     |     7 | Create, update, and delete Sentry projects; manage project environments and client keys (DSNs). |
| [`releases`](lib/skill_defs/releases.md)                       | organizer |     6 | Create and manage releases and deploys; view release health and commits.                        |
| [`replays`](lib/skill_defs/replays.md)                         | organizer |     2 | View session replays — user session recordings with error context.                              |
| [`stats`](lib/skill_defs/stats.md)                             | organizer |     2 | View organization and project usage statistics — event volume, quotas, and trends.              |
| [`traces`](lib/skill_defs/traces.md)                           | organizer |     2 | View distributed traces — full request waterfalls across services.                              |

## Always available

Reachable without loading a skill.

| Tool            | Risk | Role   | What it does                                                                                       |
| --------------- | ---- | ------ | -------------------------------------------------------------------------------------------------- |
| `get_issue`     | read | public | Get full details for a Sentry issue by its numeric ID.                                             |
| `get_project`   | read | public | Get full details for a Sentry project — platform, team, features, date created, and configuration. |
| `list_projects` | read | public | List all projects in the Sentry organization.                                                      |
| `search_issues` | read | public | Search Sentry issues across the organization.                                                      |

## `alerts`

List, create, update, and delete issue and metric alert rules.

| Tool                      | Risk        | Role      | What it does                                                                        |
| ------------------------- | ----------- | --------- | ----------------------------------------------------------------------------------- |
| `create_alert_rule`       | write       | organizer | Create a new Sentry issue alert rule.                                               |
| `delete_alert_rule`       | destructive | admin     | Permanently delete a Sentry issue alert rule.                                       |
| `get_alert_rule`          | read        | public    | Get full details for a Sentry issue alert rule, including conditions and actions.   |
| `get_metric_alert_rule`   | read        | public    | Get full details for a Sentry metric alert rule, including triggers and thresholds. |
| `list_alert_rules`        | read        | public    | List issue alert rules for a Sentry project.                                        |
| `list_metric_alert_rules` | read        | public    | List metric alert rules for the Sentry organization.                                |
| `update_alert_rule`       | write       | organizer | Update an existing Sentry issue alert rule.                                         |

## `events`

List and inspect error events, stack traces, and breadcrumbs.

| Tool                  | Risk | Role   | What it does                                                            |
| --------------------- | ---- | ------ | ----------------------------------------------------------------------- |
| `get_event`           | read | public | Get full event detail including stack trace, breadcrumbs, and contexts. |
| `get_latest_event`    | read | public | Get the most recent event for a Sentry issue.                           |
| `list_issue_events`   | read | public | List events (occurrences) for a Sentry issue.                           |
| `list_project_events` | read | public | List recent events for a Sentry project.                                |

## `issue-management`

Update, resolve, ignore, assign, delete, and tag issues.

| Tool                   | Risk        | Role      | What it does                                                                |
| ---------------------- | ----------- | --------- | --------------------------------------------------------------------------- |
| `bulk_update_issues`   | write       | organizer | Bulk update multiple Sentry issues.                                         |
| `delete_issue`         | destructive | admin     | Permanently delete a Sentry issue.                                          |
| `get_issue_tag_values` | read        | public    | Get values for a specific tag on a Sentry issue, with occurrence counts.    |
| `list_issue_tags`      | read        | public    | List tag distributions for a Sentry issue.                                  |
| `update_issue`         | write       | organizer | Update a Sentry issue — resolve, ignore, assign, set priority, or bookmark. |

## `log-search`

Search structured logs and inspect log volume over time.

| Tool            | Risk | Role   | What it does                                                    |
| --------------- | ---- | ------ | --------------------------------------------------------------- |
| `get_log_stats` | read | public | Get log volume over time, optionally grouped by severity level. |
| `search_logs`   | read | public | Search structured log entries across Sentry projects.           |

## `members`

List and manage organization members and teams; view team membership.

| Tool                 | Risk        | Role   | What it does                                                          |
| -------------------- | ----------- | ------ | --------------------------------------------------------------------- |
| `add_team_member`    | destructive | admin  | Add an organization member to a Sentry team.                          |
| `create_team`        | write       | admin  | Create a new team in the Sentry organization.                         |
| `delete_team`        | destructive | admin  | Permanently delete a Sentry team.                                     |
| `get_member`         | read        | public | Get full details for a Sentry organization member by their member ID. |
| `get_team`           | read        | public | Get full details for a Sentry team by slug.                           |
| `list_members`       | read        | public | List members in the Sentry organization.                              |
| `list_team_members`  | read        | public | List members of a Sentry team.                                        |
| `list_teams`         | read        | public | List teams in the Sentry organization.                                |
| `remove_team_member` | destructive | admin  | Remove a member from a Sentry team.                                   |
| `update_member_role` | destructive | admin  | Update a Sentry organization member's role.                           |
| `update_team`        | write       | admin  | Update a Sentry team's name or slug.                                  |

## `membership`

Invite new members to the Sentry organization or remove existing ones (admin only).

| Tool                          | Risk        | Role  | What it does                                                     |
| ----------------------------- | ----------- | ----- | ---------------------------------------------------------------- |
| `add_member_to_platform`      | destructive | admin | Invite a new member to the Sentry organization by email.         |
| `remove_member_from_platform` | destructive | admin | Remove a member from the Sentry organization by their member ID. |

## `metrics`

Query custom metrics — counters, distributions, gauges, and sets.

| Tool                    | Risk | Role   | What it does                                                                                      |
| ----------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------- |
| `get_metric_tag_values` | read | public | Get values for a specific metric tag key.                                                         |
| `list_metric_tags`      | read | public | List tag keys available for custom metrics filtering and grouping.                                |
| `list_metrics`          | read | public | List available custom metrics (counters, distributions, gauges, sets) in the Sentry organization. |
| `query_metrics`         | read | public | Query custom metrics data with aggregation.                                                       |

## `monitors`

Manage cron monitors — view schedules, check-in history, and configure runtime limits.

| Tool                    | Risk        | Role      | What it does                                                                                                 |
| ----------------------- | ----------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `delete_monitor`        | destructive | admin     | Permanently delete a Sentry cron monitor.                                                                    |
| `get_monitor`           | read        | public    | Get full details for a Sentry cron monitor — schedule config, margins, runtime limits, and check-in history. |
| `list_monitor_checkins` | read        | public    | List check-ins for a cron monitor.                                                                           |
| `list_monitors`         | read        | public    | List cron monitors (scheduled jobs) in the Sentry organization.                                              |
| `update_monitor`        | write       | organizer | Update a Sentry cron monitor's name, schedule, or runtime configuration.                                     |

## `performance`

Query transaction performance, latency, throughput, and span data.

| Tool                      | Risk | Role   | What it does                                                 |
| ------------------------- | ---- | ------ | ------------------------------------------------------------ |
| `get_transaction_summary` | read | public | Get time-series performance data for a specific transaction. |
| `list_spans`              | read | public | Query span-level data for deeper performance analysis.       |
| `list_transactions`       | read | public | List transaction events with performance metrics.            |

## `profiling`

View CPU profiling data — flamegraphs and slowest functions.

| Tool                      | Risk | Role   | What it does                                     |
| ------------------------- | ---- | ------ | ------------------------------------------------ |
| `get_flamegraph`          | read | public | Get flamegraph profiling data for a transaction. |
| `list_profiled_functions` | read | public | List the slowest profiled functions.             |

## `projects-management`

Create, update, and delete Sentry projects; manage project environments and client keys (DSNs).

| Tool                        | Risk        | Role      | What it does                                                                                  |
| --------------------------- | ----------- | --------- | --------------------------------------------------------------------------------------------- |
| `create_project`            | write       | admin     | Create a new Sentry project under a team.                                                     |
| `create_project_key`        | write       | organizer | Create a new client key (DSN) for a Sentry project.                                           |
| `delete_project`            | destructive | admin     | Permanently delete a Sentry project.                                                          |
| `delete_project_key`        | destructive | organizer | Delete a Sentry client key (DSN).                                                             |
| `list_project_environments` | read        | public    | List environments configured for a Sentry project.                                            |
| `list_project_keys`         | read        | public    | List client keys (DSNs) for a Sentry project.                                                 |
| `update_project`            | write       | organizer | Update a Sentry project's name, slug, platform, default environment, or resolve age settings. |

## `releases`

Create and manage releases and deploys; view release health and commits.

| Tool                   | Risk  | Role      | What it does                                             |
| ---------------------- | ----- | --------- | -------------------------------------------------------- |
| `create_deploy`        | write | organizer | Record a deploy for a Sentry release.                    |
| `create_release`       | write | organizer | Create a new Sentry release.                             |
| `get_release`          | read  | public    | Get full details for a Sentry release by version string. |
| `list_release_commits` | read  | public    | List commits associated with a Sentry release.           |
| `list_release_deploys` | read  | public    | List deploys for a Sentry release.                       |
| `list_releases`        | read  | public    | List releases for the Sentry organization.               |

## `replays`

View session replays — user session recordings with error context.

| Tool           | Risk | Role   | What it does                                                                                                   |
| -------------- | ---- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `get_replay`   | read | public | Get full details for a session replay — duration, error count, URLs, user info, browser/OS, and segment count. |
| `list_replays` | read | public | List session replays for the organization.                                                                     |

## `stats`

View organization and project usage statistics — event volume, quotas, and trends.

| Tool                | Risk | Role   | What it does                                                                                  |
| ------------------- | ---- | ------ | --------------------------------------------------------------------------------------------- |
| `get_org_stats`     | read | public | Get organization-level usage statistics — events received, dropped, filtered, and more.       |
| `get_project_stats` | read | public | Get event statistics for a specific Sentry project — volume over time broken down by outcome. |

## `traces`

View distributed traces — full request waterfalls across services.

| Tool          | Risk | Role   | What it does                              |
| ------------- | ---- | ------ | ----------------------------------------- |
| `get_trace`   | read | public | Get a full distributed trace by trace ID. |
| `list_traces` | read | public | Search for traces in the organization.    |
