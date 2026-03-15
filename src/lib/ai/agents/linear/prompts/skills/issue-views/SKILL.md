---
name: issue-views
description: Query and analyze issue views (user/team/project/cycle/label/custom) in list or insight mode, with additional filters.
criteria: Use for "show me issues matching X" or "count/break down issues by Y". Use search/retrieve when targeting a specific known issue.
tools: query_issue_view
---

<views>
Available slices:
- User views: "my issues", "issues I created", "issues I'm subscribed to", "recent activity"
- Team views: triage/backlog/active/all — use when the user cares about team workflow stages
- Project / milestone: when the scope is a specific project timeline or milestone deliverable
- Cycle: when the scope is a sprint/cycle; supports team current/next cycle selection
- Label: when a label defines the scope (e.g., "Security")
- Custom view: when the org has a saved view that already encodes complex filters
</views>

<list_mode>

- Paginated (limit/skip); orderable (manual/updated/created/priority).
- Best for: "show me the issues" / "what are the top 10" / "which ones are blocked?"
- Returns: id, identifier, title, priority, state, assignee, URL.
  </list_mode>

<insight_mode>

- Best for: "how many", "break down by...", "trend over time".
- Typical aggregations: issue count by assignee, by priority, by label, by status, by week.
- Use insight first when you need a quick distribution, then list mode to pull the specific outliers.
- Output: CSV (dimension,count).
  </insight_mode>

<filters>
- Keep filters explicit and simple: "status is started", "priority is high", "created in the last 7 days".
- Prefer a single AND chain; avoid mixing AND/OR across unrelated fields.
- If multiple values for one field are needed, express them as alternatives on that field (e.g., "priority is high or medium").
</filters>
