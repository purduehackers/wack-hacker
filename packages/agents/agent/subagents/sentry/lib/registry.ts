/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and splitting them lets a tool exist that no
 * skill describes. `tool_defs/` mirrors the skill list exactly, and
 * `check:capabilities` fails if it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import alertsDoc from "./skill_defs/alerts.md" with { type: "text" };
import eventsDoc from "./skill_defs/events.md" with { type: "text" };
import issueManagementDoc from "./skill_defs/issue-management.md" with { type: "text" };
import logSearchDoc from "./skill_defs/log-search.md" with { type: "text" };
import membersDoc from "./skill_defs/members.md" with { type: "text" };
import membershipDoc from "./skill_defs/membership.md" with { type: "text" };
import metricsDoc from "./skill_defs/metrics.md" with { type: "text" };
import monitorsDoc from "./skill_defs/monitors.md" with { type: "text" };
import performanceDoc from "./skill_defs/performance.md" with { type: "text" };
import profilingDoc from "./skill_defs/profiling.md" with { type: "text" };
import projectsManagementDoc from "./skill_defs/projects-management.md" with { type: "text" };
import releasesDoc from "./skill_defs/releases.md" with { type: "text" };
import replaysDoc from "./skill_defs/replays.md" with { type: "text" };
import statsDoc from "./skill_defs/stats.md" with { type: "text" };
import tracesDoc from "./skill_defs/traces.md" with { type: "text" };
import { create_alert_rule } from "./tool_defs/alerts/create_alert_rule.ts";
import { delete_alert_rule } from "./tool_defs/alerts/delete_alert_rule.ts";
import { get_alert_rule } from "./tool_defs/alerts/get_alert_rule.ts";
import { get_metric_alert_rule } from "./tool_defs/alerts/get_metric_alert_rule.ts";
import { list_alert_rules } from "./tool_defs/alerts/list_alert_rules.ts";
import { list_metric_alert_rules } from "./tool_defs/alerts/list_metric_alert_rules.ts";
import { update_alert_rule } from "./tool_defs/alerts/update_alert_rule.ts";
import { get_issue } from "./tool_defs/base/get_issue.ts";
import { get_project } from "./tool_defs/base/get_project.ts";
import { list_projects } from "./tool_defs/base/list_projects.ts";
import { search_issues } from "./tool_defs/base/search_issues.ts";
import { get_event } from "./tool_defs/events/get_event.ts";
import { get_latest_event } from "./tool_defs/events/get_latest_event.ts";
import { list_issue_events } from "./tool_defs/events/list_issue_events.ts";
import { list_project_events } from "./tool_defs/events/list_project_events.ts";
import { bulk_update_issues } from "./tool_defs/issue-management/bulk_update_issues.ts";
import { delete_issue } from "./tool_defs/issue-management/delete_issue.ts";
import { get_issue_tag_values } from "./tool_defs/issue-management/get_issue_tag_values.ts";
import { list_issue_tags } from "./tool_defs/issue-management/list_issue_tags.ts";
import { update_issue } from "./tool_defs/issue-management/update_issue.ts";
import { get_log_stats } from "./tool_defs/log-search/get_log_stats.ts";
import { search_logs } from "./tool_defs/log-search/search_logs.ts";
import { add_team_member } from "./tool_defs/members/add_team_member.ts";
import { create_team } from "./tool_defs/members/create_team.ts";
import { delete_team } from "./tool_defs/members/delete_team.ts";
import { get_member } from "./tool_defs/members/get_member.ts";
import { get_team } from "./tool_defs/members/get_team.ts";
import { list_members } from "./tool_defs/members/list_members.ts";
import { list_team_members } from "./tool_defs/members/list_team_members.ts";
import { list_teams } from "./tool_defs/members/list_teams.ts";
import { remove_team_member } from "./tool_defs/members/remove_team_member.ts";
import { update_member_role } from "./tool_defs/members/update_member_role.ts";
import { update_team } from "./tool_defs/members/update_team.ts";
import { add_member_to_platform } from "./tool_defs/membership/add_member_to_platform.ts";
import { remove_member_from_platform } from "./tool_defs/membership/remove_member_from_platform.ts";
import { get_metric_tag_values } from "./tool_defs/metrics/get_metric_tag_values.ts";
import { list_metric_tags } from "./tool_defs/metrics/list_metric_tags.ts";
import { list_metrics } from "./tool_defs/metrics/list_metrics.ts";
import { query_metrics } from "./tool_defs/metrics/query_metrics.ts";
import { delete_monitor } from "./tool_defs/monitors/delete_monitor.ts";
import { get_monitor } from "./tool_defs/monitors/get_monitor.ts";
import { list_monitor_checkins } from "./tool_defs/monitors/list_monitor_checkins.ts";
import { list_monitors } from "./tool_defs/monitors/list_monitors.ts";
import { update_monitor } from "./tool_defs/monitors/update_monitor.ts";
import { get_transaction_summary } from "./tool_defs/performance/get_transaction_summary.ts";
import { list_spans } from "./tool_defs/performance/list_spans.ts";
import { list_transactions } from "./tool_defs/performance/list_transactions.ts";
import { get_flamegraph } from "./tool_defs/profiling/get_flamegraph.ts";
import { list_profiled_functions } from "./tool_defs/profiling/list_profiled_functions.ts";
import { create_project } from "./tool_defs/projects-management/create_project.ts";
import { create_project_key } from "./tool_defs/projects-management/create_project_key.ts";
import { delete_project } from "./tool_defs/projects-management/delete_project.ts";
import { delete_project_key } from "./tool_defs/projects-management/delete_project_key.ts";
import { list_project_environments } from "./tool_defs/projects-management/list_project_environments.ts";
import { list_project_keys } from "./tool_defs/projects-management/list_project_keys.ts";
import { update_project } from "./tool_defs/projects-management/update_project.ts";
import { create_deploy } from "./tool_defs/releases/create_deploy.ts";
import { create_release } from "./tool_defs/releases/create_release.ts";
import { get_release } from "./tool_defs/releases/get_release.ts";
import { list_release_commits } from "./tool_defs/releases/list_release_commits.ts";
import { list_release_deploys } from "./tool_defs/releases/list_release_deploys.ts";
import { list_releases } from "./tool_defs/releases/list_releases.ts";
import { get_replay } from "./tool_defs/replays/get_replay.ts";
import { list_replays } from "./tool_defs/replays/list_replays.ts";
import { get_org_stats } from "./tool_defs/stats/get_org_stats.ts";
import { get_project_stats } from "./tool_defs/stats/get_project_stats.ts";
import { get_trace } from "./tool_defs/traces/get_trace.ts";
import { list_traces } from "./tool_defs/traces/list_traces.ts";

export const SENTRY_TOOLS = {
  add_member_to_platform,
  add_team_member,
  bulk_update_issues,
  create_alert_rule,
  create_deploy,
  create_project,
  create_project_key,
  create_release,
  create_team,
  delete_alert_rule,
  delete_issue,
  delete_monitor,
  delete_project,
  delete_project_key,
  delete_team,
  get_alert_rule,
  get_event,
  get_flamegraph,
  get_issue,
  get_issue_tag_values,
  get_latest_event,
  get_log_stats,
  get_member,
  get_metric_alert_rule,
  get_metric_tag_values,
  get_monitor,
  get_org_stats,
  get_project,
  get_project_stats,
  get_release,
  get_replay,
  get_team,
  get_trace,
  get_transaction_summary,
  list_alert_rules,
  list_issue_events,
  list_issue_tags,
  list_members,
  list_metric_alert_rules,
  list_metric_tags,
  list_metrics,
  list_monitor_checkins,
  list_monitors,
  list_profiled_functions,
  list_project_environments,
  list_project_events,
  list_project_keys,
  list_projects,
  list_release_commits,
  list_release_deploys,
  list_releases,
  list_replays,
  list_spans,
  list_team_members,
  list_teams,
  list_traces,
  list_transactions,
  query_metrics,
  remove_member_from_platform,
  remove_team_member,
  search_issues,
  search_logs,
  update_alert_rule,
  update_issue,
  update_member_role,
  update_monitor,
  update_project,
  update_team,
} as const satisfies Record<string, DomainToolSpec>;

export type SentryToolName = keyof typeof SENTRY_TOOLS;

export const SENTRY_BASE_TOOL_NAMES = [
  "list_projects",
  "get_project",
  "search_issues",
  "get_issue",
] as const;

export const SENTRY_SKILLS = [
  {
    name: "alerts",
    minRole: "organizer",
    doc: alertsDoc,
    tools: [
      "list_alert_rules",
      "get_alert_rule",
      "create_alert_rule",
      "update_alert_rule",
      "delete_alert_rule",
      "list_metric_alert_rules",
      "get_metric_alert_rule",
    ],
  },
  {
    name: "events",
    minRole: "organizer",
    doc: eventsDoc,
    tools: ["list_issue_events", "get_event", "get_latest_event", "list_project_events"],
  },
  {
    name: "issue-management",
    minRole: "organizer",
    doc: issueManagementDoc,
    tools: [
      "update_issue",
      "delete_issue",
      "bulk_update_issues",
      "list_issue_tags",
      "get_issue_tag_values",
    ],
  },
  {
    name: "log-search",
    minRole: "organizer",
    doc: logSearchDoc,
    tools: ["search_logs", "get_log_stats"],
  },
  {
    name: "members",
    minRole: "organizer",
    doc: membersDoc,
    tools: [
      "list_members",
      "get_member",
      "update_member_role",
      "list_teams",
      "get_team",
      "list_team_members",
      "create_team",
      "update_team",
      "delete_team",
      "add_team_member",
      "remove_team_member",
    ],
  },
  {
    name: "membership",
    minRole: "admin",
    doc: membershipDoc,
    tools: ["add_member_to_platform", "remove_member_from_platform"],
  },
  {
    name: "metrics",
    minRole: "organizer",
    doc: metricsDoc,
    tools: ["list_metrics", "query_metrics", "list_metric_tags", "get_metric_tag_values"],
  },
  {
    name: "monitors",
    minRole: "organizer",
    doc: monitorsDoc,
    tools: [
      "list_monitors",
      "get_monitor",
      "list_monitor_checkins",
      "update_monitor",
      "delete_monitor",
    ],
  },
  {
    name: "performance",
    minRole: "organizer",
    doc: performanceDoc,
    tools: ["list_transactions", "get_transaction_summary", "list_spans"],
  },
  {
    name: "profiling",
    minRole: "organizer",
    doc: profilingDoc,
    tools: ["get_flamegraph", "list_profiled_functions"],
  },
  {
    name: "projects-management",
    minRole: "admin",
    doc: projectsManagementDoc,
    tools: [
      "create_project",
      "update_project",
      "delete_project",
      "list_project_environments",
      "list_project_keys",
      "create_project_key",
      "delete_project_key",
    ],
  },
  {
    name: "releases",
    minRole: "organizer",
    doc: releasesDoc,
    tools: [
      "list_releases",
      "get_release",
      "create_release",
      "list_release_deploys",
      "create_deploy",
      "list_release_commits",
    ],
  },
  {
    name: "replays",
    minRole: "organizer",
    doc: replaysDoc,
    tools: ["list_replays", "get_replay"],
  },
  {
    name: "stats",
    minRole: "organizer",
    doc: statsDoc,
    tools: ["get_org_stats", "get_project_stats"],
  },
  {
    name: "traces",
    minRole: "organizer",
    doc: tracesDoc,
    tools: ["get_trace", "list_traces"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];
