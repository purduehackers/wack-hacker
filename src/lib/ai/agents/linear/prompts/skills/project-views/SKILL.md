---
name: project-views
description: Query and analyze project views (all/initiative/label/custom) in list or count mode, with additional filters.
criteria: Use for "show/count projects matching X". Use search/retrieve for a specific project by name/slug/URL.
tools: query_project_view
---

<views>
Available scopes:
- Workspace: all projects
- Initiative-scoped: projects in an initiative, optionally by facet
- Project label: filter by label
- Custom view: saved views with pre-encoded filters
</views>

<list_mode>

- See individual projects with status/lead/health/priority and timestamps.
- Supports pagination and ordering.
- Use when you need "which projects are..."
  </list_mode>

<count_mode>

- Fast totals: "how many active projects?"
- Use when you only need aggregate numbers, not details.
  </count_mode>

<filters>
- Keep it explicit: "status is planned", "members include X", "labels include Customer".
- Use list mode for "which projects are..."; count mode for "how many..."
</filters>

<initiative_usage>

- Use initiative view when a rollup across projects contributing to a strategic effort is needed.
  </initiative_usage>
