import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import alertsDoc from "../lib/skill_defs/alerts.md" with { type: "text" };
import eventsDoc from "../lib/skill_defs/events.md" with { type: "text" };
import issueManagementDoc from "../lib/skill_defs/issue-management.md" with { type: "text" };
import logSearchDoc from "../lib/skill_defs/log-search.md" with { type: "text" };
import membersDoc from "../lib/skill_defs/members.md" with { type: "text" };
import membershipDoc from "../lib/skill_defs/membership.md" with { type: "text" };
import metricsDoc from "../lib/skill_defs/metrics.md" with { type: "text" };
import monitorsDoc from "../lib/skill_defs/monitors.md" with { type: "text" };
import performanceDoc from "../lib/skill_defs/performance.md" with { type: "text" };
import profilingDoc from "../lib/skill_defs/profiling.md" with { type: "text" };
import projectsManagementDoc from "../lib/skill_defs/projects-management.md" with { type: "text" };
import releasesDoc from "../lib/skill_defs/releases.md" with { type: "text" };
import replaysDoc from "../lib/skill_defs/replays.md" with { type: "text" };
import statsDoc from "../lib/skill_defs/stats.md" with { type: "text" };
import tracesDoc from "../lib/skill_defs/traces.md" with { type: "text" };

export const SENTRY_BASE_TOOL_NAMES = [
  "list_projects",
  "get_project",
  "search_issues",
  "get_issue",
] as const;

export const SENTRY_SKILL_DEFINITIONS = [
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

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, SENTRY_SKILL_DEFINITIONS),
  },
});
