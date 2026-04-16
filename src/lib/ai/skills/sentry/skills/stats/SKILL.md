---
name: stats
description: View organization and project usage statistics — event volume, quotas, and trends.
criteria: Use when the user asks about Sentry usage, event volume, quotas, dropped events, or ingestion stats.
tools: [get_org_stats, get_project_stats]
minRole: organizer
mode: inline
---

<org_stats>

- get_org_stats returns time-series usage data for the entire organization.
- Group by "outcome" to see received vs dropped vs filtered events.
- Group by "project" to compare event volume across projects.
- Group by "category" to break down by error, transaction, attachment, etc.
  </org_stats>

<project_stats>

- get_project_stats returns event volume for a single project.
- Useful for checking if a project is generating excessive events.
  </project_stats>
