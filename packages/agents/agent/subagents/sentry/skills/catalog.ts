import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const SENTRY_BASE_TOOL_NAMES = [
  "list_projects",
  "get_project",
  "search_issues",
  "get_issue",
] as const;

export const SENTRY_SKILL_DEFINITIONS = [
  {
    name: "alerts",
    description: "List, create, update, and delete issue and metric alert rules.",
    criteria:
      "Use when the user wants to view, create, modify, or delete alert rules or notification triggers.",
    minRole: "organizer",
    tools: [
      "list_alert_rules",
      "get_alert_rule",
      "create_alert_rule",
      "update_alert_rule",
      "delete_alert_rule",
      "list_metric_alert_rules",
      "get_metric_alert_rule",
    ],
    instructions:
      '<issue_alerts>\n\n- Issue alert rules trigger on individual events (e.g., new issue, regression, high frequency).\n- list_alert_rules and get_alert_rule operate per-project.\n- create_alert_rule requires: project slug, name, conditions, actions, and frequency.\n- Common conditions: "A new issue is created", "An event is seen more than {value} times in {interval}".\n- Common actions: "Send a notification to {service}" (Slack, email, PagerDuty).\n  </issue_alerts>\n\n<metric_alerts>\n\n- Metric alert rules trigger on aggregate data (error count, latency percentiles, crash rate).\n- list_metric_alert_rules and get_metric_alert_rule are org-level.\n- These are more complex; prefer viewing over creation unless the user provides detailed config.\n  </metric_alerts>\n\n<deleting>\n- delete_alert_rule is irreversible. Requires explicit user intent.\n</deleting>',
  },
  {
    name: "events",
    description: "List and inspect error events, stack traces, and breadcrumbs.",
    criteria:
      "Use when the user wants to see error details, stack traces, event history, or breadcrumbs.",
    minRole: "organizer",
    tools: ["list_issue_events", "get_event", "get_latest_event", "list_project_events"],
    instructions:
      "<events>\n- list_issue_events shows all occurrences of a specific issue.\n- get_latest_event is the fastest way to see a current stack trace.\n- get_event requires both project_slug and event_id.\n</events>\n\n<stack_traces>\n\n- Summarize the exception chain: type, value, and top 3-5 relevant frames.\n- Skip library/framework frames unless the user asks for the full trace.\n- Highlight the application code frame closest to the error.\n  </stack_traces>\n\n<breadcrumbs>\n- Events include breadcrumbs (console logs, HTTP requests, navigation) leading up to the error.\n- Summarize the last 5-10 breadcrumbs for context.\n</breadcrumbs>",
  },
  {
    name: "issue-management",
    description: "Update, resolve, ignore, assign, delete, and tag issues.",
    criteria:
      "Use when the user wants to resolve, ignore, assign, delete issues, or inspect issue tags.",
    minRole: "organizer",
    tools: [
      "update_issue",
      "delete_issue",
      "bulk_update_issues",
      "list_issue_tags",
      "get_issue_tag_values",
    ],
    instructions:
      '<resolving>\n- update_issue with status "resolved" to resolve. Include status_details for resolve conditions:\n  - `{ "inRelease": "latest" }` — resolve in latest release\n  - `{ "inNextRelease": true }` — resolve in next release\n  - `{ "inCommit": { "commit": "sha", "repository": "org/repo" } }` — resolve in commit\n</resolving>\n\n<ignoring>\n- update_issue with status "ignored". Optional status_details:\n  - `{ "ignoreDuration": 30 }` — ignore for 30 minutes\n  - `{ "ignoreCount": 100 }` — ignore until seen 100 more times\n  - `{ "ignoreWindow": 60, "ignoreCount": 100 }` — 100 times in 60 minutes\n</ignoring>\n\n<assigning>\n- update_issue with assigned_to: "username", "team:team-slug", or "" to unassign.\n</assigning>\n\n<bulk>\n- bulk_update_issues can resolve, ignore, or assign multiple issues at once by ID list.\n</bulk>\n\n<tags>\n- list_issue_tags shows tag key distribution (browser, os, environment, etc.).\n- get_issue_tag_values drills into specific tag values and their counts.\n</tags>',
  },
  {
    name: "log-search",
    description: "Search structured logs and inspect log volume over time.",
    criteria:
      "Use when the user asks about application logs, log search, log levels, or log spikes/volume over time.",
    minRole: "organizer",
    tools: ["search_logs", "get_log_stats"],
    instructions:
      "<search>\n- search_logs queries structured log entries across a project's `logs` dataset.\n- Filter with `query` using Sentry search syntax — e.g. `level:error`, `message:*timeout*`, or tag filters.\n- `stat_period` bounds the window (`1h`, `24h`, `7d`; default `24h`); `sort` defaults to `-timestamp`.\n- `fields` picks the columns returned (default: message, severity_text, timestamp, trace_id).\n</search>\n\n<stats>\n- get_log_stats returns log volume as a time series — use it to spot spikes before drilling in with search_logs.\n- `y_axis` defaults to `count()`; narrow with `query`, bound with `stat_period`.\n</stats>",
  },
  {
    name: "members",
    description: "List and manage organization members and teams; view team membership.",
    criteria:
      "Use when the user wants to view org members, teams, manage team membership, or create/delete teams.",
    minRole: "organizer",
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
    instructions:
      "<members>\n- list_members shows all org members with roles and team assignments.\n- Members are identified by numeric member ID.\n- Roles include: owner, manager, admin, member, billing.\n- Pending members have been invited but haven't accepted yet.\n</members>\n\n<teams>\n- Teams are identified by slug, not name.\n- create_team auto-generates a slug from the name if not provided.\n- delete_team is irreversible. Requires explicit user intent.\n</teams>\n\n<membership>\n- add_team_member and remove_team_member require both member_id and team_slug.\n- Use list_members to find member IDs before adding/removing.\n</membership>",
  },
  {
    name: "membership",
    description:
      "Invite new members to the Sentry organization or remove existing ones (admin only).",
    criteria:
      "Use when the user wants to add a new member to the Sentry organization or remove an existing member.",
    minRole: "admin",
    tools: ["add_member_to_platform", "remove_member_from_platform"],
    instructions:
      "<adding>\n- add_member_to_platform invites by email. Role defaults to 'member'; other roles include 'admin', 'manager', 'owner', 'billing'.\n- Never fabricate an email — always confirm the exact address.\n- Optionally assign to teams by slug via team_roles.\n- Returns invite id, email, role, and pending status.\n</adding>\n\n<removing>\n- remove_member_from_platform removes a member by their Sentry member ID (not email).\n- Resolve the member ID via list_members first — never remove on ambiguous input.\n- Confirm with the user before calling — this is destructive.\n</removing>",
  },
  {
    name: "metrics",
    description: "Query custom metrics — counters, distributions, gauges, and sets.",
    criteria:
      "Use when the user asks about custom metrics, counters, distributions, gauges, or application-level numeric data.",
    minRole: "organizer",
    tools: ["list_metrics", "query_metrics", "list_metric_tags", "get_metric_tag_values"],
    instructions:
      "<metrics>\n- list_metrics shows all available custom metrics and their types.\n- Metrics use MRI (Metric Resource Identifier) format: `{type}:custom/{name}@{unit}`.\n- Types: c (counter), d (distribution), g (gauge), s (set).\n- Example MRI: `c:custom/page_views@none`, `d:custom/response_time@millisecond`.\n</metrics>\n\n<querying>\n- query_metrics returns time-series data for a specific metric.\n- Aggregation ops: sum, count, avg, min, max, p50, p75, p90, p95, p99.\n- Use group_by to break down by tag (e.g. environment, endpoint).\n- Use query to filter by tag values (e.g. 'environment:production').\n</querying>\n\n<tags>\n- list_metric_tags shows available tag keys for filtering/grouping.\n- get_metric_tag_values shows values for a specific tag.\n</tags>",
  },
  {
    name: "monitors",
    description:
      "Manage cron monitors — view schedules, check-in history, and configure runtime limits.",
    criteria:
      "Use when the user asks about cron jobs, scheduled tasks, monitors, missed check-ins, or job failures.",
    minRole: "organizer",
    tools: [
      "list_monitors",
      "get_monitor",
      "list_monitor_checkins",
      "update_monitor",
      "delete_monitor",
    ],
    instructions:
      '<monitors>\n- list_monitors shows all cron monitors with their schedule and status.\n- Status: "ok", "missed_checkin", "error", "disabled", "active".\n- Schedule types: "crontab" (e.g., "0 * * * *") or "interval" (e.g., every 10 minutes).\n</monitors>\n\n<checkins>\n- list_monitor_checkins shows the history of check-ins for a monitor.\n- Check-in statuses: "ok", "missed_checkin", "error", "in_progress", "timeout".\n- Duration shows how long the job ran (null if missed).\n</checkins>\n\n<updating>\n- update_monitor can change the name, schedule, margins, and runtime limits.\n- checkin_margin: minutes of grace before marking a check-in as missed.\n- max_runtime: minutes before a running check-in is marked as failed.\n</updating>\n\n<deleting>\n- delete_monitor is irreversible. Requires explicit user intent.\n</deleting>',
  },
  {
    name: "performance",
    description: "Query transaction performance, latency, throughput, and span data.",
    criteria:
      "Use when the user asks about slow endpoints, latency, throughput, p95/p99, or transaction performance.",
    minRole: "organizer",
    tools: ["list_transactions", "get_transaction_summary", "list_spans"],
    instructions:
      "<transactions>\n- list_transactions uses the Discover API to query transaction events.\n- Common fields: transaction, count(), p50(), p75(), p95(), p99(), avg().\n- Filter by project, date range, and transaction name.\n</transactions>\n\n<stats>\n- get_transaction_summary returns time-series performance data for a specific transaction.\n- Useful for spotting regressions or trends.\n</stats>\n\n<spans>\n- list_spans queries span-level data for deeper performance analysis.\n- Use to find slow database queries, HTTP calls, or specific operations within a transaction.\n</spans>",
  },
  {
    name: "profiling",
    description: "View CPU profiling data — flamegraphs and slowest functions.",
    criteria:
      "Use when the user asks about profiling, flamegraphs, CPU usage, slow functions, or function-level performance.",
    minRole: "organizer",
    tools: ["get_flamegraph", "list_profiled_functions"],
    instructions:
      "<flamegraph>\n- get_flamegraph returns CPU time distribution across function calls.\n- Requires project_slug and transaction name.\n- Useful for identifying which functions consume the most CPU time.\n</flamegraph>\n\n<functions>\n- list_profiled_functions shows the slowest functions by self-time.\n- Sort by p75(), p95(), p99(), count(), or avg().\n- Filter by transaction to focus on a specific endpoint.\n- Shows function name, package, and time percentiles.\n</functions>",
  },
  {
    name: "projects-management",
    description:
      "Create, update, and delete Sentry projects; manage project environments and client keys (DSNs).",
    criteria:
      "Use when the user wants to create/delete a Sentry project, update project settings, or manage DSNs/environments.",
    minRole: "admin",
    tools: [
      "create_project",
      "update_project",
      "delete_project",
      "list_project_environments",
      "list_project_keys",
      "create_project_key",
      "delete_project_key",
    ],
    instructions:
      "- create_project requires a team_slug owner and a platform (e.g. 'javascript-nextjs').\n- update_project resolve_age: hours after which unhandled issues auto-resolve (0 to disable).\n- delete_project is irreversible — removes all issues, events, and config.\n- Client keys (DSNs) are what SDKs use to ingest events. delete_project_key breaks all clients using that DSN.\n- Environments are auto-created when events come in with an environment tag; list_project_environments shows what's seen so far.",
  },
  {
    name: "releases",
    description: "Create and manage releases and deploys; view release health and commits.",
    criteria:
      "Use when the user wants to create releases, record deploys, view release health, or see release commits.",
    minRole: "organizer",
    tools: [
      "list_releases",
      "get_release",
      "create_release",
      "list_release_deploys",
      "create_deploy",
      "list_release_commits",
    ],
    instructions:
      '<releases>\n- Releases are identified by version string (e.g., "1.0.0", a commit SHA, or a semver tag).\n- list_releases returns releases sorted by date. Filter by project if needed.\n- create_release requires a version and at least one project slug.\n</releases>\n\n<deploys>\n- create_deploy records a deployment for a release. Requires environment name (e.g., "production", "staging").\n- Deploys track when a release was shipped to an environment.\n</deploys>\n\n<commits>\n- list_release_commits shows commits associated with a release.\n- Commits are typically set during release creation via refs or commit list.\n</commits>',
  },
  {
    name: "replays",
    description: "View session replays — user session recordings with error context.",
    criteria:
      "Use when the user asks about session replays, user recordings, or wants to see what a user experienced.",
    minRole: "organizer",
    tools: ["list_replays", "get_replay"],
    instructions:
      "<replays>\n- list_replays returns session recordings with duration, error count, and user info.\n- Filter by user email, error count, duration, or activity level.\n- Sort by started_at, duration, or count_errors.\n- Default time range is 7 days.\n</replays>\n\n<details>\n- get_replay returns full details for a single replay.\n- Includes URLs visited, browser/OS info, segment count, and error count.\n- Replay IDs are UUIDs.\n</details>",
  },
  {
    name: "stats",
    description:
      "View organization and project usage statistics — event volume, quotas, and trends.",
    criteria:
      "Use when the user asks about Sentry usage, event volume, quotas, dropped events, or ingestion stats.",
    minRole: "organizer",
    tools: ["get_org_stats", "get_project_stats"],
    instructions:
      '<org_stats>\n\n- get_org_stats returns time-series usage data for the entire organization.\n- Group by "outcome" to see received vs dropped vs filtered events.\n- Group by "project" to compare event volume across projects.\n- Group by "category" to break down by error, transaction, attachment, etc.\n  </org_stats>\n\n<project_stats>\n\n- get_project_stats returns event volume for a single project.\n- Useful for checking if a project is generating excessive events.\n  </project_stats>',
  },
  {
    name: "traces",
    description: "View distributed traces — full request waterfalls across services.",
    criteria:
      "Use when the user asks about traces, distributed tracing, request waterfalls, or wants to follow a request across services.",
    minRole: "organizer",
    tools: ["get_trace", "list_traces"],
    instructions:
      "<traces>\n- get_trace returns the full trace waterfall for a specific trace ID.\n- Includes all transactions, spans, errors, and performance issues.\n- Trace IDs are 32-character hex strings.\n</traces>\n\n<searching>\n- list_traces searches for traces via the Discover API.\n- Filter by transaction name, duration, or other event fields.\n- Results include trace ID, transaction name, and timestamps.\n</searching>",
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, SENTRY_SKILL_DEFINITIONS),
  },
});
