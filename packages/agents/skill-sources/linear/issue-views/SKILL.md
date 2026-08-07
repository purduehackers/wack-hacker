---
name: issue-views
description: Query and analyze issue views in list or insight mode, with filters.
criteria: Use for "show me issues matching X" or "count/break down issues by Y".
tools: [query_issue_view]
minRole: organizer
mode: inline
---

<views>
Available slices: user views (my issues, created, subscribed, recent activity), team views (triage/backlog/active/all), project/milestone, cycle, label, custom view.
</views>

<list_mode>

- Paginated (limit/skip); orderable (manual/updated/created/priority).
- Best for: "show me the issues", "top 10", "which ones are blocked?"
  </list_mode>

<insight_mode>

- Best for: "how many", "break down by...", "trend over time".
- Typical aggregations: count by assignee, priority, label, status, week.
- Output: CSV (dimension,count).
  </insight_mode>

<filters>
- Keep filters explicit and simple. Prefer single AND chains.
- If multiple values for one field, express as alternatives on that field.
</filters>
