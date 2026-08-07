import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import * as m_alerts from "./alerts.ts";
import * as m_base from "./base.ts";
import * as m_events from "./events.ts";
import * as m_issue_management from "./issue-management.ts";
import * as m_logs from "./logs.ts";
import * as m_members from "./members.ts";
import * as m_membership from "./membership.ts";
import * as m_metrics from "./metrics.ts";
import * as m_monitors from "./monitors.ts";
import * as m_performance from "./performance.ts";
import * as m_profiling from "./profiling.ts";
import * as m_projects_management from "./projects-management.ts";
import * as m_releases from "./releases.ts";
import * as m_replays from "./replays.ts";
import * as m_stats from "./stats.ts";
import * as m_traces from "./traces.ts";

export const SENTRY_TOOLS = {
  add_member_to_platform: m_membership.add_member_to_platform,
  add_team_member: m_members.add_team_member,
  bulk_update_issues: m_issue_management.bulk_update_issues,
  create_alert_rule: m_alerts.create_alert_rule,
  create_deploy: m_releases.create_deploy,
  create_project: m_projects_management.create_project,
  create_project_key: m_projects_management.create_project_key,
  create_release: m_releases.create_release,
  create_team: m_members.create_team,
  delete_alert_rule: m_alerts.delete_alert_rule,
  delete_issue: m_issue_management.delete_issue,
  delete_monitor: m_monitors.delete_monitor,
  delete_project: m_projects_management.delete_project,
  delete_project_key: m_projects_management.delete_project_key,
  delete_team: m_members.delete_team,
  get_alert_rule: m_alerts.get_alert_rule,
  get_event: m_events.get_event,
  get_flamegraph: m_profiling.get_flamegraph,
  get_issue: m_base.get_issue,
  get_issue_tag_values: m_issue_management.get_issue_tag_values,
  get_latest_event: m_events.get_latest_event,
  get_log_stats: m_logs.get_log_stats,
  get_member: m_members.get_member,
  get_metric_alert_rule: m_alerts.get_metric_alert_rule,
  get_metric_tag_values: m_metrics.get_metric_tag_values,
  get_monitor: m_monitors.get_monitor,
  get_org_stats: m_stats.get_org_stats,
  get_project: m_base.get_project,
  get_project_stats: m_stats.get_project_stats,
  get_release: m_releases.get_release,
  get_replay: m_replays.get_replay,
  get_team: m_members.get_team,
  get_trace: m_traces.get_trace,
  get_transaction_summary: m_performance.get_transaction_summary,
  list_alert_rules: m_alerts.list_alert_rules,
  list_issue_events: m_events.list_issue_events,
  list_issue_tags: m_issue_management.list_issue_tags,
  list_members: m_members.list_members,
  list_metric_alert_rules: m_alerts.list_metric_alert_rules,
  list_metric_tags: m_metrics.list_metric_tags,
  list_metrics: m_metrics.list_metrics,
  list_monitor_checkins: m_monitors.list_monitor_checkins,
  list_monitors: m_monitors.list_monitors,
  list_profiled_functions: m_profiling.list_profiled_functions,
  list_project_environments: m_projects_management.list_project_environments,
  list_project_events: m_events.list_project_events,
  list_project_keys: m_projects_management.list_project_keys,
  list_projects: m_base.list_projects,
  list_release_commits: m_releases.list_release_commits,
  list_release_deploys: m_releases.list_release_deploys,
  list_releases: m_releases.list_releases,
  list_replays: m_replays.list_replays,
  list_spans: m_performance.list_spans,
  list_team_members: m_members.list_team_members,
  list_teams: m_members.list_teams,
  list_traces: m_traces.list_traces,
  list_transactions: m_performance.list_transactions,
  query_metrics: m_metrics.query_metrics,
  remove_member_from_platform: m_membership.remove_member_from_platform,
  remove_team_member: m_members.remove_team_member,
  search_issues: m_base.search_issues,
  search_logs: m_logs.search_logs,
  update_alert_rule: m_alerts.update_alert_rule,
  update_issue: m_issue_management.update_issue,
  update_member_role: m_members.update_member_role,
  update_monitor: m_monitors.update_monitor,
  update_project: m_projects_management.update_project,
  update_team: m_members.update_team,
} as const satisfies Record<string, DomainToolSpec>;
